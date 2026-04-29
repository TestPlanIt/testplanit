import type { AdapterType } from "@prisma/client";

/** A successfully parsed inbound webhook payload. */
export interface ParsedWebhookPayload {
  /** Event identifier, e.g. "jira:issue_updated". Used for delivery row eventType column. */
  eventType: string;
  /** External system's issue key (Jira: "DEMO-42"; GitHub: PR/issue number; ADO: work item id). */
  issueKey: string;
  /** Raw external status string, written verbatim into Issue.externalStatus per D-09. */
  externalStatus: string;
  /** True for self-test pings (D-20); receiver short-circuits AFTER dedup INSERT but BEFORE Issue lookup (per BLOCKER #5 in plan 01-03). */
  synthetic: boolean;
}

/** Verifier success branch. */
export interface VerifyOk {
  valid: true;
  payload: ParsedWebhookPayload;
}

/** Verifier failure branch — never throws; always returns this. */
export interface VerifyFail {
  valid: false;
  /** Stable, non-PII machine-readable code. Receiver maps this to HTTP status. */
  reason:
    | "missing-signature"
    | "malformed-signature"
    | "signature-mismatch"
    | "unparseable-body"
    | "missing-required-field"
    | "missing-auth"
    | "auth-mismatch";
}

export type VerifyResult = VerifyOk | VerifyFail;

export interface WebhookAdapter {
  readonly adapterType: AdapterType;
  /**
   * Pure function: verify HMAC signature against rawBody+secret, then parse.
   * MUST NOT do I/O (no DB, no fetch, no fs). All I/O happens in the route handler.
   */
  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult;
  /**
   * D-03 / WBHK-10 — extract the external system reference for the linked
   * Issue lookup. Returns null when the payload has no extractable ref.
   * NOTE: `externalSystem` is informational metadata carried in audit logs
   * and is NOT used as a DB filter (Issue lookup uses externalKey + projectId).
   */
  extractLinkedIssueRef(payload: unknown): {
    externalKey: string;
    externalSystem: AdapterType;
  } | null;
  /**
   * D-02 / WBHK-08 — extract the external status string from the payload.
   * Returns null when the event doesn't carry status (routes to D-15 no_handler skip).
   */
  extractExternalStatus(payload: unknown, eventType: string): string | null;
}

// =============================================================================
// v0.23.0 Phase 2 — outbound webhook adapter types
// =============================================================================

/**
 * OUT-20 / D-14 — common envelope across all outbound webhook events.
 * Stamped at emit time; the adapter's format() function is responsible for
 * mapping it to the wire format the destination expects.
 */
export interface OutboundEnvelope {
  /** Stable across retries (OUT-05). UUID v4 prefixed with "evt_". */
  eventId: string;
  /** "<entity>.<verb>" per OUT-21 / D-13 (e.g. "test_run.completed"). */
  eventName: string;
  /** ISO-8601 with Z suffix. */
  eventTimestamp: string;
  /** Tenant ID for multi-tenant deployments; matches `process.env.TENANT_ID` shape. */
  tenantId: string | null;
  projectId: number;
  projectName: string;
  /** null when actor is the system (e.g. backfill, scheduled job). */
  actorUserId: string | null;
  /** Event-specific data — shape varies per eventName (D-09..D-13 catalog). */
  data: Record<string, unknown>;
}

/** Output of an adapter's format() function — the HTTP body + content type. */
export interface FormattedHttpRequest {
  /** Pre-stringified JSON ready to send. The dispatcher does NOT re-stringify. */
  body: string;
  contentType: string;
}

/** D-06 / D-19 — signing-secret set passed to sign(). */
export interface SigningSecretSet {
  /** Plaintext active secret (already decrypted by the dispatcher before calling sign). */
  active: string;
  /** Plaintext retiring secret during the 7-day overlap window. Null in steady state (D-06). */
  retiring?: string | null;
}

/** Headers returned by sign() — merged with the dispatcher's base headers (Content-Type, etc.). */
export type SignatureHeaders = Record<string, string>;

/**
 * Phase 2 outbound adapter interface (dual of the Phase 1 inbound WebhookAdapter).
 * Phase 2 ships SLACK + GENERIC_HMAC; Phase 4 may add Microsoft Teams etc.
 */
export interface OutboundWebhookAdapter {
  readonly adapterType: AdapterType;
  /**
   * Pure function: shape an envelope into the wire payload the destination expects.
   * Slack returns Block Kit JSON; generic-HMAC returns the envelope verbatim.
   * MUST NOT do I/O.
   */
  format(envelope: OutboundEnvelope): FormattedHttpRequest;
  /**
   * Optional signing function (Slack omits this — D-18). When present, the
   * dispatcher calls it after format() with the produced body string and
   * the active+retiring secret set, and merges the returned headers into
   * the outgoing request.
   */
  sign?(body: string, secrets: SigningSecretSet): SignatureHeaders;
}
