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
  metadata?: { synthetic?: boolean };
}

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
    synthetic: p.metadata?.synthetic === true,
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
};
