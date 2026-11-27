import { createHmac, timingSafeEqual } from "node:crypto";
import type { AdapterType } from "~/zenstack/models";
import type {
  ParsedWebhookPayload,
  VerifyResult,
  WebhookAdapter,
} from "./types";

// Gitea signs the raw body with HMAC-SHA256.
// Signature header: X-Gitea-Signature (the bare 64-hex digest; a "sha256="
//                   prefix, as on X-Hub-Signature-256, is accepted too)
// Event header:     X-Gitea-Event     (e.g. "issues")
const SIGNATURE_HEADER = "x-gitea-signature";
const EVENT_HEADER = "x-gitea-event";
const SIGNATURE_PREFIX = "sha256=";
const HEX_64_RE = /^[0-9a-f]{64}$/;

// Synthetic sentinels — Gitea issue numbers are positive integers ≥ 1.
const SYNTHETIC_REPO_FULL_NAME = "__synthetic__/__synthetic__";
const SYNTHETIC_ISSUE_NUMBER = 0;

interface GiteaIssuesPayload {
  action?: string;
  issue?: {
    number?: number;
    state?: string;
    title?: string;
    milestone?: { id?: number } | null;
  };
  repository?: { full_name?: string };
}

/**
 * Gitea has no event for a milestone itself. The one milestone signal it
 * sends is the `issues` event's `milestoned` action, with the milestone the
 * issue now belongs to on the issue; that becomes `milestone_milestoned`,
 * the shape the receiver route dispatches to milestone sync. `demilestoned`
 * names no milestone at all, so it stays an ordinary issue event.
 */
function milestoneEventType(
  headerEvent: string,
  payload: GiteaIssuesPayload
): string | null {
  if (
    headerEvent === "issues" &&
    payload.action === "milestoned" &&
    typeof payload.issue?.milestone?.id === "number"
  ) {
    return "milestone_milestoned";
  }
  return null;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const giteaAdapter: WebhookAdapter = {
  adapterType: "GITEA" satisfies AdapterType,

  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult {
    const sig = headers.get(SIGNATURE_HEADER);
    if (!sig) return { valid: false, reason: "missing-signature" };
    const provided = (
      sig.startsWith(SIGNATURE_PREFIX)
        ? sig.slice(SIGNATURE_PREFIX.length)
        : sig
    ).toLowerCase();
    if (!HEX_64_RE.test(provided)) {
      return { valid: false, reason: "malformed-signature" };
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    if (!constantTimeEqualHex(provided, expected)) {
      return { valid: false, reason: "signature-mismatch" };
    }

    const headerEvent = headers.get(EVENT_HEADER);
    if (!headerEvent) return { valid: false, reason: "missing-required-field" };

    let parsed: GiteaIssuesPayload;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as GiteaIssuesPayload;
    } catch {
      return { valid: false, reason: "unparseable-body" };
    }

    const eventType = milestoneEventType(headerEvent, parsed) ?? headerEvent;

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
    const p = raw as GiteaIssuesPayload;
    const repo = p.repository?.full_name;
    const num = p.issue?.number;
    if (typeof repo !== "string" || typeof num !== "number") return null;
    return {
      externalKey: `${repo}#${num}`,
      externalSystem: "GITEA" satisfies AdapterType,
      externalId: String(num),
    };
  },

  extractExternalStatus(payload, eventType) {
    if (eventType !== "issues") return null;
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as GiteaIssuesPayload;
    const state = p.issue?.state;
    return typeof state === "string" ? state : null;
  },

  extractMilestoneEventRef(payload, eventType) {
    if (!eventType.startsWith("milestone_")) return null;
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const p = raw as GiteaIssuesPayload;
    const repo = p.repository?.full_name;
    const id = p.issue?.milestone?.id;
    if (typeof repo !== "string" || typeof id !== "number") return null;
    return {
      kind: "RELEASE",
      externalId: `${repo}#${id}`,
      externalProjectId: repo,
      merge: false,
    };
  },
};
