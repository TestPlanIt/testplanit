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
    | "missing-required-field";
}

export type VerifyResult = VerifyOk | VerifyFail;

export interface WebhookAdapter {
  readonly adapterType: AdapterType;
  /**
   * Pure function: verify HMAC signature against rawBody+secret, then parse.
   * MUST NOT do I/O (no DB, no fetch, no fs). All I/O happens in the route handler.
   */
  verify(rawBody: Buffer, headers: Headers, secret: string): VerifyResult;
}
