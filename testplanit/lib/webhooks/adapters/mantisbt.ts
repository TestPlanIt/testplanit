import type { AdapterType } from "~/zenstack/models";
import type {
  ParsedWebhookPayload,
  VerifyResult,
  WebhookAdapter,
} from "./types";

/**
 * Inbound webhook adapter for a MantisBT webhook plugin.
 *
 * Auth model — URL token, NOT a signature. MantisBT core emits no webhooks; a
 * server-side webhook plugin posts JSON but does not sign it. The unguessable
 * per-config token in the receiver URL (`/api/webhooks/<token>`) is therefore
 * the credential — the receiver authenticates by resolving the WebhookConfig
 * from that token before this adapter runs. `verify()` does no HMAC; it only
 * parses and shape-checks the body. The encrypted WebhookConfig.secret is
 * unused for MantisBT.
 *
 * Payload shape — Mantis webhook plugins are not standardized, so parsing is
 * defensive. We look for the issue id and a status name across the common
 * shapes:
 *   { event|action|event_type: "issue_created" | "issue_updated" | ...,
 *     issue|bug|data: { id, status: { name|label } | status: "<string>" } }
 *
 * issueKey is `#<id>` to match MantisBTAdapter.mapIssue's `key`, which is what
 * gets stored as Issue.externalKey and what applyInboundIssueUpdate matches on.
 */

// Sentinel issue id for self-test pings — real Mantis issue ids are >= 1.
const SYNTHETIC_ISSUE_ID = 0;

interface MantisWebhookBody {
  event?: string;
  action?: string;
  event_type?: string;
  issue?: MantisWebhookIssue;
  bug?: MantisWebhookIssue;
  data?: MantisWebhookIssue;
}

interface MantisWebhookIssue {
  id?: number;
  status?: { name?: string; label?: string } | string;
}

function issueKeyFor(id: number): string {
  return `#${id}`;
}

/** Pull the issue object out of whichever envelope field carries it. */
function issueOf(body: MantisWebhookBody): MantisWebhookIssue | undefined {
  return body.issue ?? body.bug ?? body.data;
}

/** Read a status name from either the object or string status shape. */
function statusOf(issue: MantisWebhookIssue | undefined): string | null {
  const status = issue?.status;
  if (typeof status === "string") return status;
  if (status && typeof status === "object") {
    return status.name ?? status.label ?? null;
  }
  return null;
}

/** The action verb from whichever envelope field carries it. */
function actionOf(body: MantisWebhookBody): string | undefined {
  return body.event ?? body.action ?? body.event_type;
}

export const mantisbtAdapter: WebhookAdapter = {
  adapterType: "MANTISBT" satisfies AdapterType,

  verify(rawBody: Buffer, _headers: Headers, _secret: string): VerifyResult {
    // No signature to verify — the URL token (already validated by the receiver)
    // is the credential. Parse and shape-check only.
    let parsed: MantisWebhookBody;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as MantisWebhookBody;
    } catch {
      return { valid: false, reason: "unparseable-body" };
    }

    const issue = issueOf(parsed);
    const id = issue?.id;
    const action = actionOf(parsed);
    if (typeof id !== "number" || typeof action !== "string" || !action) {
      return { valid: false, reason: "missing-required-field" };
    }

    const status = statusOf(issue);
    const payload: ParsedWebhookPayload = {
      eventType: `mantisbt:issue_${action}`,
      issueKey: issueKeyFor(id),
      externalStatus: status ?? "",
      synthetic: id === SYNTHETIC_ISSUE_ID,
      data: parsed,
    };
    return { valid: true, payload };
  },

  extractLinkedIssueRef(payload) {
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const id = issueOf(raw as MantisWebhookBody)?.id;
    if (typeof id !== "number") return null;
    return {
      externalKey: issueKeyFor(id),
      externalSystem: "MANTISBT" satisfies AdapterType,
    };
  },

  extractExternalStatus(payload, eventType) {
    // Any MantisBT issue event carries the issue with a status.
    if (!eventType.startsWith("mantisbt:issue_")) return null;
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    return statusOf(issueOf(raw as MantisWebhookBody));
  },
};
