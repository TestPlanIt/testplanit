/**
 * Shared types for the webhooks/services layer.
 *
 * Owns the contract between the receiver (plan 01-04 — `app/api/webhooks/[token]/route.ts`)
 * and the domain service (`applyInboundIssueUpdate` — renamed from `applyJiraIssueUpdate`
 * in Phase 3 P-02). The closed-set `DeliveryOutcome` values are mapped by the receiver
 * to HTTP responses; tests assert against them directly. Adding a new branch later
 * (e.g. retry-after) requires deliberate type widening.
 */

import type { AdapterType } from "@prisma/client";

import type { ParsedWebhookPayload } from "~/lib/webhooks/adapters/types";

// Re-export so callers using `~/lib/webhooks/services/types` keep working;
// the adapter file is the canonical source of truth (D-22..D-24).
export type { ParsedWebhookPayload };

/**
 * D-03 / WBHK-10 — informational external system reference written into audit
 * metadata. NOT used as a DB filter for Issue lookup (D-22: no
 * `Issue.externalSystem` column exists).
 */
export interface LinkedIssueRef {
  /** External system key (Jira: "TP-123"; GitHub: "owner/repo#42"; ADO: "123"). */
  externalKey: string;
  /**
   * Informational adapter source — written into audit metadata.
   * NOT used as a DB filter for Issue lookup (D-22: no Issue.externalSystem column exists).
   */
  externalSystem: AdapterType;
}

/**
 * Input passed by the receiver after successful HMAC verification + parse.
 *
 * The service receives the verified `payload` plus `adapterType` + `eventType`
 * from the receiver and itself calls `getAdapter(adapterType).extractLinkedIssueRef(payload)`
 * + `.extractExternalStatus(payload, eventType)` (Phase 3 P-02 — service-side
 * extractor delegation per RESEARCH.md Q2 RESOLVED). The receiver does NOT
 * re-parse `rawBody`; the adapter's `verify()` is the single point of body parsing.
 */
export interface ApplyInboundIssueUpdateInput {
  /** The verified WebhookConfig row (looked up by token in the receiver). */
  webhookConfigId: string;
  projectId: number;
  /** Resolved from the verified WebhookConfig row; service uses this to call getAdapter(). */
  adapterType: AdapterType;
  /** Event identifier (e.g. "jira:issue_updated", "issues", "workitem.updated"); passed to extractExternalStatus. */
  eventType: string;
  /** Parsed webhook payload from the adapter's verify() success branch. */
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
  | "no_handler" // adapter returned null externalStatus (e.g. GitHub `push`); delivery row written, no dedup, no Issue mutation (D-15)
  | "duplicate" // dedup row pre-existed for this payloadDigest (WBHK-06)
  | "synthetic" // self-test ping (D-20) — short-circuited inside synthetic branch (writes dedup so SC#5 second click → duplicate)
  | "error"; // unexpected DB error during processing — receiver returns 500

/**
 * What the service returns to the receiver.
 */
export interface ApplyInboundIssueUpdateResult {
  outcome: DeliveryOutcome;
  /** ID of the WebhookDelivery row written (always set unless outcome === "error" pre-insert). */
  deliveryId?: string;
  /** Issue.id of the updated Issue (only set when outcome === "updated"). */
  issueId?: number;
  /** Human-readable error/skip reason mirroring the WebhookDelivery.error column. */
  reason?: string;
}

/**
 * @deprecated Phase 3 P-02 renamed the service to `applyInboundIssueUpdate`.
 * Use `ApplyInboundIssueUpdateInput`. P-05 removes this alias once the
 * receiver call site in `app/api/webhooks/[token]/route.ts` is updated.
 */
export type ApplyJiraIssueUpdateInput = ApplyInboundIssueUpdateInput;

/**
 * @deprecated Phase 3 P-02 renamed the service to `applyInboundIssueUpdate`.
 * Use `ApplyInboundIssueUpdateResult`. P-05 removes this alias once the
 * receiver call site in `app/api/webhooks/[token]/route.ts` is updated.
 */
export type ApplyJiraIssueUpdateResult = ApplyInboundIssueUpdateResult;
