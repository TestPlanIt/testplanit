/**
 * Shared types for the webhooks/services layer.
 *
 * Owns the contract between the receiver (`app/api/webhooks/[token]/route.ts`)
 * and the domain service (`applyInboundIssueUpdate`). The closed-set
 * `DeliveryOutcome` values are mapped by the receiver to HTTP responses;
 * tests assert against them directly. Adding a new branch later
 * (e.g. retry-after) requires deliberate type widening.
 */

import type { AdapterType } from "~/zenstack/models";

import type { ParsedWebhookPayload } from "~/lib/webhooks/adapters/types";

// Re-export so callers using `~/lib/webhooks/services/types` keep working;
// the adapter file is the canonical source of truth.
export type { ParsedWebhookPayload };

/**
 * Informational external system reference written into audit metadata.
 * NOT used as a DB filter for Issue lookup (no `Issue.externalSystem` column exists).
 */
export interface LinkedIssueRef {
  /** External system key (Jira: "TP-123"; GitHub: "owner/repo#42"; ADO: "123"). */
  externalKey: string;
  /**
   * Informational adapter source — written into audit metadata.
   * NOT used as a DB filter for Issue lookup (no Issue.externalSystem column exists).
   */
  externalSystem: AdapterType;
}

/**
 * Input passed by the receiver after successful HMAC verification + parse.
 *
 * The service receives the verified `payload` plus `adapterType` + `eventType`
 * from the receiver and itself calls `getAdapter(adapterType).extractLinkedIssueRef(payload)`
 * + `.extractExternalStatus(payload, eventType)`. The receiver does NOT
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
  | "updated" // linked Issue found, status applied
  | "no-link" // no linked Issue, delivery row written, no Issue mutation, dedup row never written
  | "no_handler" // adapter returned null externalStatus (e.g. GitHub `push`); delivery row written, no dedup, no Issue mutation
  | "duplicate" // dedup row pre-existed for this payloadDigest
  | "synthetic" // self-test ping — short-circuited inside synthetic branch (writes dedup so a second click → duplicate)
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
 * Input passed by the receiver for a jira:version_* / sprint_* eventType,
 * after successful HMAC verification + parse. Sibling to
 * `ApplyInboundIssueUpdateInput` — same shape, no `projectId` field because
 * the milestone event resolves its OWN project from the payload (Pitfall 6),
 * never the receiving WebhookConfig's project.
 */
export interface ApplyInboundMilestoneEventInput {
  /** The verified WebhookConfig row (looked up by token in the receiver). */
  webhookConfigId: string;
  /** Resolved from the verified WebhookConfig row; service uses this to call getAdapter(). */
  adapterType: AdapterType;
  /** Event identifier (e.g. "jira:version_updated", "sprint_deleted"). */
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
 * Closed-set outcome enum for milestone events. Mirrors `DeliveryOutcome`'s
 * shape/HTTP-mapping contract (receiver maps `error` -> 5xx, everything else
 * -> 200) but with milestone-specific outcome names.
 */
export type MilestoneDeliveryOutcome =
  | "refreshed" // resolved project matched an active integration; performMilestoneRefresh invoked
  | "imported" // version_created/sprint_created with auto-track ON; performMilestoneImport invoked (D-02)
  | "converted" // version_deleted/merged or sprint_deleted; convertMilestoneToLocal invoked
  | "unmatched" // D-03: resolved project/board has no active integration mapping — silent ack, no write
  | "no-ref" // adapter could not extract a milestone ref from the payload
  | "duplicate" // dedup row pre-existed for this payloadDigest
  | "error"; // unexpected DB error during processing — receiver returns 500

export interface ApplyInboundMilestoneEventResult {
  outcome: MilestoneDeliveryOutcome;
  /** ID of the WebhookDelivery row written (always set unless outcome === "error" pre-insert). */
  deliveryId?: string;
  /** Milestones.id affected (only set when outcome === "refreshed" or "converted" and a linked row was found). */
  milestoneId?: number;
  /** Human-readable error/skip reason mirroring the WebhookDelivery.error column. */
  reason?: string;
}
