import type { AdapterType } from "~/zenstack/models";
import type {
  ParsedWebhookPayload,
  VerifyResult,
  WebhookAdapter,
} from "./types";

/**
 * Inbound webhook adapter for the `redmine_webhook` plugin.
 *
 * Auth model — URL token, NOT a signature. Redmine core emits no webhooks; the
 * `redmine_webhook` plugin posts JSON but cannot sign it or send custom headers
 * (the captured deliveries carry only Faraday/content-type headers). The
 * unguessable per-config token in the receiver URL (`/api/webhooks/<token>`) is
 * therefore the credential — the receiver authenticates by resolving the
 * WebhookConfig from that token before this adapter runs. `verify()` does no
 * HMAC; it only parses and shape-checks the body. The encrypted
 * WebhookConfig.secret is unused for Redmine.
 *
 * Payload shape (captured from redmine_webhook against Redmine 6.1.2):
 *   { payload: { action: "opened" | "updated",
 *                issue: { id, status: { name }, ... },
 *                journal?: { ... },   // present on "updated"
 *                url } }
 *
 * issueKey is `#<id>` to match RedmineAdapter.mapIssue's `key`, which is what
 * gets stored as Issue.externalKey and what applyInboundIssueUpdate matches on.
 */

// Sentinel issue id for self-test pings — real Redmine issue ids are >= 1.
const SYNTHETIC_ISSUE_ID = 0;

interface RedmineWebhookBody {
  payload?: {
    action?: string;
    issue?: {
      id?: number;
      status?: { name?: string };
    };
    url?: string;
  };
}

function issueKeyFor(id: number): string {
  return `#${id}`;
}

export const redmineAdapter: WebhookAdapter = {
  adapterType: "REDMINE" satisfies AdapterType,

  verify(rawBody: Buffer, _headers: Headers, _secret: string): VerifyResult {
    // No signature to verify — the URL token (already validated by the receiver)
    // is the credential. Parse and shape-check only.
    let parsed: RedmineWebhookBody;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as RedmineWebhookBody;
    } catch {
      return { valid: false, reason: "unparseable-body" };
    }

    const p = parsed.payload;
    const id = p?.issue?.id;
    const action = p?.action;
    if (typeof id !== "number" || typeof action !== "string" || !action) {
      return { valid: false, reason: "missing-required-field" };
    }

    const status = p?.issue?.status?.name;
    const payload: ParsedWebhookPayload = {
      eventType: `redmine:issue_${action}`,
      issueKey: issueKeyFor(id),
      externalStatus: typeof status === "string" ? status : "",
      synthetic: id === SYNTHETIC_ISSUE_ID,
      data: parsed,
    };
    return { valid: true, payload };
  },

  extractLinkedIssueRef(payload) {
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const id = (raw as RedmineWebhookBody).payload?.issue?.id;
    if (typeof id !== "number") return null;
    return {
      externalKey: issueKeyFor(id),
      externalSystem: "REDMINE" satisfies AdapterType,
    };
  },

  extractExternalStatus(payload, eventType) {
    // Both "opened" and "updated" carry the full issue with status.name.
    if (
      eventType !== "redmine:issue_opened" &&
      eventType !== "redmine:issue_updated"
    ) {
      return null;
    }
    const raw = (payload as ParsedWebhookPayload).data ?? payload;
    const name = (raw as RedmineWebhookBody).payload?.issue?.status?.name;
    return typeof name === "string" ? name : null;
  },
};
