import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdapterType } from "@prisma/client";
import type {
  ParsedWebhookPayload,
  VerifyResult,
  WebhookAdapter,
} from "./types";

const SIGNATURE_HEADER = "x-hub-signature-256";
const EVENT_HEADER = "x-github-event";
const SIGNATURE_PREFIX = "sha256=";
const HEX_64_RE = /^[0-9a-f]{64}$/;

/**
 * HI-02 sentinel (D-03 synthetic binding): the self-loop server action
 * emits this exact (repository.full_name, issue.number) combination in its
 * synthetic GitHub-shaped payload. Real GitHub instances cannot legitimately
 * produce a repo with double-underscore segments AND issue.number === 0
 * (GitHub issue numbers are positive integers ≥ 1), so the synthetic flag
 * is non-forgeable from the wire even by a caller holding a valid HMAC.
 */
const SYNTHETIC_REPO_FULL_NAME = "__synthetic__/__synthetic__";
const SYNTHETIC_ISSUE_NUMBER = 0;

interface GithubIssuesPayload {
  action?: string;
  issue?: {
    number?: number;
    state?: string;
    state_reason?: string | null;
    title?: string;
  };
  repository?: { full_name?: string };
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const githubAdapter: WebhookAdapter = {
  adapterType: "GITHUB" satisfies AdapterType,

  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult {
    const sig = headers.get(SIGNATURE_HEADER);
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

    const eventType = headers.get(EVENT_HEADER);
    if (!eventType) return { valid: false, reason: "missing-required-field" };

    let parsed: GithubIssuesPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as GithubIssuesPayload;
    } catch {
      return { valid: false, reason: "unparseable-body" };
    }

    const repo = parsed.repository?.full_name;
    const num = parsed.issue?.number;
    const issueKey =
      typeof repo === "string" && typeof num === "number"
        ? `${repo}#${num}`
        : "";
    const externalStatus =
      typeof parsed.issue?.state === "string" ? parsed.issue.state : "";
    const synthetic =
      repo === SYNTHETIC_REPO_FULL_NAME && num === SYNTHETIC_ISSUE_NUMBER;

    const payload: ParsedWebhookPayload = {
      eventType,
      issueKey,
      externalStatus,
      synthetic,
      data: parsed,
    };
    return { valid: true, payload };
  },

  extractLinkedIssueRef(payload) {
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as GithubIssuesPayload;
    const repo = p.repository?.full_name;
    const num = p.issue?.number;
    if (typeof repo !== "string" || typeof num !== "number") return null;
    return {
      externalKey: `${repo}#${num}`,
      externalSystem: "GITHUB" satisfies AdapterType,
    };
  },

  extractExternalStatus(payload, eventType) {
    if (eventType !== "issues") return null;
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as GithubIssuesPayload;
    const state = p.issue?.state;
    return typeof state === "string" ? state : null;
  },
};
