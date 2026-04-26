/**
 * Shared types for the webhooks/services layer.
 *
 * Owns the contract between the receiver (plan 01-04 — `app/api/webhooks/[token]/route.ts`)
 * and the domain service (`applyJiraIssueUpdate`). The five `DeliveryOutcome` values
 * form a closed set that the receiver maps to HTTP responses; tests assert against them
 * directly. Adding a new branch later (e.g. retry-after) requires deliberate type widening.
 */

import type { ParsedWebhookPayload } from "~/lib/webhooks/adapters/types";

// Re-export so callers using `~/lib/webhooks/services/types` keep working;
// the adapter file is the canonical source of truth (D-22..D-24).
export type { ParsedWebhookPayload };

/**
 * Input passed by the receiver after successful HMAC verification + parse.
 */
export interface ApplyJiraIssueUpdateInput {
  /** The verified WebhookConfig row (looked up by token in the receiver). */
  webhookConfigId: string;
  projectId: number;
  /** Parsed Jira payload from the adapter. */
  payload: ParsedWebhookPayload;
  /** SHA-256 hex digest of the raw request body — primary idempotency key, also stored on the delivery row. */
  payloadDigest: string;
  /** Wall-clock receive time (set by the receiver before calling the service). */
  receivedAt: Date;
  /** Latency in ms from receive to current moment — service will record on the delivery row. */
  latencyMs: number;
  /** HTTP status code the receiver intends to return — recorded on the delivery row. Default 200 for successful processing. */
  statusCode: number;
}

/**
 * Closed-set outcome enum. Receiver maps these to HTTP responses; tests assert on this.
 */
export type DeliveryOutcome =
  | "updated" // linked Issue found, status applied (D-09)
  | "no-link" // no linked Issue, delivery row written, no Issue mutation, dedup row never written (D-14)
  | "duplicate" // dedup INSERT threw P2002 (D-15 REVISED / WBHK-06)
  | "synthetic" // self-test ping (D-20) — short-circuited inside synthetic branch (writes dedup so SC#5 second click → duplicate)
  | "error"; // unexpected DB error during processing — receiver returns 500

/**
 * What the service returns to the receiver.
 */
export interface ApplyJiraIssueUpdateResult {
  outcome: DeliveryOutcome;
  /** ID of the WebhookDelivery row written (always set unless outcome === "error" pre-insert). */
  deliveryId?: string;
  /** Issue.id of the updated Issue (only set when outcome === "updated"). */
  issueId?: number;
  /** Human-readable error/skip reason mirroring the WebhookDelivery.error column. */
  reason?: string;
}
