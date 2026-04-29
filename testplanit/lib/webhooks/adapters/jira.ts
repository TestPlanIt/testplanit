import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdapterType } from "@prisma/client";
import type {
  ParsedWebhookPayload,
  VerifyResult,
  WebhookAdapter,
} from "./types";

const SIGNATURE_HEADER_PRIMARY = "x-hub-signature-256";
// Atlassian's legacy webhook setup form labels its signature header
// `x-hub-signature` — same name GitHub uses for SHA-1, but Jira sends
// SHA-256 under it. We accept both header names; the strict
// `sha256=` prefix + 64-hex-char regex below prevents a real GitHub
// SHA-1 signature (`sha1=...`) from passing verification.
const SIGNATURE_HEADER_FALLBACK = "x-hub-signature";
const SIGNATURE_PREFIX = "sha256=";
const HEX_64_RE = /^[0-9a-f]{64}$/;

function readSignature(headers: Headers): string | null {
  // Headers API is case-insensitive — `headers.get` handles casing.
  const raw =
    headers.get(SIGNATURE_HEADER_PRIMARY) ??
    headers.get(SIGNATURE_HEADER_FALLBACK);
  return raw ? raw.trim() : null;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface JiraWebhookPayload {
  webhookEvent?: string;
  issue?: {
    key?: string;
    fields?: { status?: { name?: string } };
  };
  // NOTE: `metadata.synthetic` is intentionally NOT modeled here. HI-02:
  // any caller with a valid HMAC could otherwise set `metadata.synthetic`
  // to `true` and silently suppress production Issue updates.
}

/**
 * HI-02 sentinel: the self-loop server action emits this exact issue.key
 * in its synthetic Jira-shaped payload. The receiver detects this key and
 * short-circuits the linked-Issue step. A real Jira instance — or anyone
 * with the secret — cannot trigger the synthetic path because it would
 * have to send `__synthetic__` as the actual Jira issue key, which Jira
 * itself does not produce. Server-side intent is bound to a value an
 * external caller cannot legitimately forge.
 */
export const SYNTHETIC_ISSUE_KEY = "__synthetic__";

function parsePayload(rawBody: Buffer): JiraWebhookPayload | null {
  try {
    return JSON.parse(rawBody.toString("utf8")) as JiraWebhookPayload;
  } catch {
    return null;
  }
}

function buildPayload(p: JiraWebhookPayload): ParsedWebhookPayload | null {
  const issueKey = p.issue?.key;
  const externalStatus = p.issue?.fields?.status?.name;
  const eventType = p.webhookEvent ?? "jira:unknown";
  if (!issueKey || !externalStatus) return null;
  return {
    eventType,
    issueKey,
    externalStatus,
    // HI-02: `synthetic` is bound to the sentinel issue.key, NOT to any
    // wire-controllable metadata field. This is the only way for the
    // receiver to learn "this came from the self-loop" without trusting
    // attacker-supplied JSON.
    synthetic: issueKey === SYNTHETIC_ISSUE_KEY,
  };
}

export const jiraAdapter: WebhookAdapter = {
  adapterType: "JIRA" satisfies AdapterType,

  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult {
    const sig = readSignature(headers);
    if (!sig) return { valid: false, reason: "missing-signature" };
    if (!sig.startsWith(SIGNATURE_PREFIX)) {
      return { valid: false, reason: "malformed-signature" };
    }
    const provided = sig.slice(SIGNATURE_PREFIX.length).toLowerCase();
    if (!HEX_64_RE.test(provided)) {
      return { valid: false, reason: "malformed-signature" };
    }
    const expected = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    if (!constantTimeEqualHex(provided, expected)) {
      return { valid: false, reason: "signature-mismatch" };
    }
    const parsed = parsePayload(rawBody);
    if (!parsed) {
      return { valid: false, reason: "unparseable-body" };
    }
    const payload = buildPayload(parsed);
    if (!payload) {
      return { valid: false, reason: "missing-required-field" };
    }
    return { valid: true, payload };
  },

  extractLinkedIssueRef(payload) {
    const p = payload as { issue?: { key?: unknown } };
    const key = p.issue?.key;
    if (typeof key !== "string" || key.length === 0) return null;
    return { externalKey: key, externalSystem: "JIRA" satisfies AdapterType };
  },

  extractExternalStatus(payload, eventType) {
    if (eventType !== "jira:issue_updated") return null;
    const p = payload as {
      issue?: { fields?: { status?: { name?: unknown } } };
    };
    const name = p.issue?.fields?.status?.name;
    return typeof name === "string" ? name : null;
  },
};
