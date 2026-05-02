import type { AdapterType } from "@prisma/client";

import { SYSTEM_ACTOR_ID } from "~/lib/auditContext";
import { syncService } from "~/lib/integrations/services/SyncService";
import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getAdapter } from "~/lib/webhooks/adapters";

import type {
  ApplyInboundIssueUpdateInput,
  ApplyInboundIssueUpdateResult,
} from "./types";

/**
 * Webhook-triggered freshness window — coalesces rapid Jira/GitHub/ADO
 * event bursts (e.g. status change + assignee change firing within a few
 * seconds) into a single upstream API pull. The next event after the
 * window expires triggers another full sync. Tail-end change at most
 * `WEBHOOK_SYNC_FRESHNESS_SECONDS`s lag, in exchange for predictable
 * upstream API rate consumption during burst patterns.
 */
const WEBHOOK_SYNC_FRESHNESS_SECONDS = 15;

/**
 * Map webhook adapter type → Integration provider value. The webhook
 * carries `WebhookConfig.adapterType` (JIRA / GITHUB / AZURE_DEVOPS); the
 * Integration model uses `IntegrationProvider` (JIRA / GITHUB / AZURE_DEVOPS).
 * They line up 1:1 today but `inboundProviderForAdapter` documents the
 * mapping so a future adapter without a corresponding integration provider
 * (e.g. SLACK inbound, hypothetical) can return null and skip system sync.
 */
function inboundProviderForAdapter(
  adapterType: AdapterType
): "JIRA" | "GITHUB" | "AZURE_DEVOPS" | null {
  switch (adapterType) {
    case "JIRA":
      return "JIRA";
    case "GITHUB":
      return "GITHUB";
    case "AZURE_DEVOPS":
      return "AZURE_DEVOPS";
    default:
      return null;
  }
}

/**
 * After an inbound webhook commits the dedup row for a linked issue,
 * trigger a full sync via `performIssueRefreshSystem`. Resolves the
 * project's single active ProjectIntegration whose provider matches the
 * webhook adapter; if none, logs and skips so the webhook receipt stays
 * successful.
 *
 * Failures here do NOT roll back the dedup row — the upstream is the
 * source of truth, and the next webhook event for the issue (or the next
 * hover/manual sync) will reconcile. Sync errors land in console + the
 * standard SyncService logging surface; the webhook delivery row is
 * already finalized as "updated" (the application-level apply outcome).
 */
async function triggerSystemSyncForInboundEvent(args: {
  projectId: number;
  adapterType: AdapterType;
  externalKey: string;
  /**
   * When true, the post-commit sync creates a fresh local Issue row if
   * one doesn't already exist (auto-create on linked-but-missing). When
   * false (default), the sync only updates an existing row and throws
   * if missing — matching the legacy manual-sync contract.
   */
  createIfMissing?: boolean;
}): Promise<void> {
  const provider = inboundProviderForAdapter(args.adapterType);
  if (!provider) {
    console.warn(
      `[applyInboundIssueUpdate] skipping system sync — adapter ${args.adapterType} has no integration provider mapping`
    );
    return;
  }

  // Single active integration per project (enforced in app code). Filter
  // by provider so a project with a Jira integration but a GitHub webhook
  // (cross-tenant misconfiguration) doesn't trigger the wrong adapter.
  const projectIntegration = await prisma.projectIntegration.findFirst({
    where: {
      projectId: args.projectId,
      isActive: true,
      integration: { provider, isDeleted: false },
    },
    include: { integration: { select: { id: true } } },
  });

  if (!projectIntegration) {
    console.warn(
      `[applyInboundIssueUpdate] skipping system sync — no active ${provider} integration for project ${args.projectId}`
    );
    return;
  }

  const result = await syncService.performIssueRefreshSystem(
    projectIntegration.integration.id,
    args.externalKey,
    {
      minFreshnessSeconds: WEBHOOK_SYNC_FRESHNESS_SECONDS,
      // Only the auto-create branch threads `createIfMissing` through —
      // the regular update branch is fine throwing on missing (it would
      // mean an Issue was deleted between the dedup INSERT and this call,
      // which is a real anomaly worth surfacing).
      ...(args.createIfMissing
        ? { createIfMissing: { projectId: args.projectId } }
        : {}),
    }
  );

  if (!result.success) {
    console.error(
      `[applyInboundIssueUpdate] system sync failed for issue ${args.externalKey}: ${result.error ?? "unknown"}`
    );
  }
}

const REASON_MAX_LEN = 500;

function truncate(s: string): string {
  return s.length > REASON_MAX_LEN ? s.slice(0, REASON_MAX_LEN) : s;
}

/**
 * Domain entry point for the inbound webhook receiver — adapter-agnostic.
 *
 * The service is parametrized by `adapterType` and is the single owner of
 * the adapter→extractor relationship for inbound flows: the receiver hands
 * over `{ adapterType, eventType, payload, ... }` and this service itself
 * calls `getAdapter(adapterType).extractLinkedIssueRef(payload)` +
 * `.extractExternalStatus(payload, eventType)`. The route handler does NOT
 * re-parse rawBody and does NOT call adapter extractors directly.
 *
 * 3-model architecture:
 *   - WebhookDelivery: every HTTP receive gets a row (delivery LOG).
 *   - WebhookEventDedup: idempotency tracker; @@unique([webhookConfigId, payloadDigest]).
 *
 * Dedup is written ONLY when the payload would actually be applied (synthetic
 * short-circuit OR linked-Issue branch). The no-link, no_handler, and
 * no-link-upfront branches never touch the dedup table — no INSERT, no DELETE
 * — which preserves retry-after-link semantics without serializing on the
 * dedup row during the no-link lifetime.
 *
 * Idempotency check pattern: a pre-INSERT SELECT against `WebhookEventDedup`
 * detects duplicates without relying on catch-after-throw inside the transaction.
 * Postgres aborts the tx on any error (including unique-constraint P2002), so a
 * try/catch around tx.create() inside $transaction() leaves subsequent tx
 * operations unable to run. The SELECT pattern keeps the tx clean. The TOCTOU
 * race (two concurrent webhooks both passing the SELECT) is handled by the
 * unique constraint at INSERT time: the loser's tx aborts, the outer catch
 * returns `outcome: "error"` (5xx), and the sender's retry sees the
 * now-committed row from the winner and correctly returns `outcome: "duplicate"`
 * on the second attempt.
 *
 * Flow inside the transaction:
 *   1. Resolve adapter once via getAdapter(input.adapterType) BEFORE the tx.
 *   2. Compute linkedRef + externalStatus by calling adapter extractors.
 *   3. ALWAYS INSERT a WebhookDelivery row (delivery log entry).
 *   4. If externalStatus === null → no_handler skip: finalize delivery
 *      row with error='no_handler', bump lastReceivedAt, return 'no_handler'.
 *      Dedup never touched. Issue lookup never performed.
 *   5. If linkedRef === null → no-link-upfront skip: finalize delivery row
 *      with error='no-link', bump lastReceivedAt, return 'no-link'. Dedup
 *      never touched. Issue lookup never performed.
 *   6. SELECT WebhookEventDedup to detect a prior application of this payload.
 *   7. If payload.synthetic:
 *        - Existing dedup row → finalize delivery error='duplicate',
 *          return 'duplicate' (second synthetic click).
 *        - No prior row → INSERT dedup, finalize delivery error='synthetic',
 *          return 'synthetic'.
 *   8. Otherwise look up linked Issue (tenant-scoped to projectId).
 *      Where clause filters by externalKey + projectId + isDeleted=false ONLY.
 *      NO `externalSystem` filter — Issue.externalSystem is NOT a DB column;
 *      linkedRef.externalSystem is informational metadata.
 *   9. No linked Issue → finalize delivery error='no-link', return
 *      'no-link'. Dedup never touched.
 *  10. Linked Issue:
 *        - Existing dedup row → finalize delivery error='duplicate',
 *          return 'duplicate'. No Issue mutation.
 *        - No prior row → INSERT dedup, update Issue.externalStatus +
 *          Issue.lastSyncedAt, finalize delivery error=null, return 'updated'.
 *
 * Shared tail (every accepted receipt): bump WebhookConfig.lastReceivedAt
 * — every accepted receipt counts, including duplicates.
 *
 * After tx commit: emit WEBHOOK_RECEIVED audit. actor='__system__'.
 * Audit emission is awaited – the captureAuditEvent helper enqueues onto BullMQ
 * and returns quickly.
 */
export async function applyInboundIssueUpdate(
  input: ApplyInboundIssueUpdateInput
): Promise<ApplyInboundIssueUpdateResult> {
  const {
    webhookConfigId,
    projectId,
    adapterType,
    eventType,
    payload,
    payloadDigest,
    receivedAt,
    latencyMs,
    statusCode,
  } = input;

  // Adapter is resolved from `input.adapterType` (sourced by the receiver
  // from the verified WebhookConfig row), NOT from any wire-controlled body
  // field. An attacker cannot smuggle an adapter selection in the request body.
  const adapter = getAdapter(adapterType);
  const linkedRef = adapter.extractLinkedIssueRef(payload);
  const externalStatus = adapter.extractExternalStatus(payload, eventType);

  type TxOutcome =
    // `issueId` is nullable for the auto-create variant: at tx-commit
    // time the local Issue doesn't exist yet, so the post-commit sync
    // is what mints it. `wasAutoCreated` distinguishes this case in the
    // audit metadata without needing a separate public outcome value.
    | {
        outcome: "updated";
        deliveryId: string;
        issueId: number | null;
        wasAutoCreated?: boolean;
      }
    | { outcome: "no-link"; deliveryId: string }
    | { outcome: "no_handler"; deliveryId: string }
    | { outcome: "duplicate"; deliveryId: string }
    | { outcome: "synthetic"; deliveryId: string };

  let txResult: TxOutcome;

  try {
    txResult = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
      // Step 1: ALWAYS insert a delivery log row first.
      const delivery = await tx.webhookDelivery.create({
        data: {
          webhookConfigId,
          direction: "INBOUND",
          adapterType: adapterType,
          eventType: eventType,
          statusCode: null,
          latencyMs: null,
          payloadDigest,
          error: null,
          attempt: 1,
          receivedAt,
        },
      });

      // Step 2: no_handler skip — adapter declined to extract a status for
      // this eventType (e.g. GitHub `push`, ADO `build.complete`). Write
      // the delivery row with error='no_handler', skip dedup + Issue lookup
      // entirely. Minimal DB work for unsupported events.
      if (externalStatus === null) {
        await tx.webhookDelivery.update({
          where: { id: delivery.id },
          data: { statusCode, latencyMs, error: "no_handler" },
        });
        await tx.webhookConfig.update({
          where: { id: webhookConfigId },
          data: { lastReceivedAt: receivedAt },
        });
        return { outcome: "no_handler", deliveryId: delivery.id };
      }

      // Step 3: no-link-upfront skip — adapter could not extract a linked
      // issue ref from the payload (e.g. GitHub issues event lacking
      // repository.full_name). Mirror the existing no-link semantics:
      // delivery row + no dedup + no Issue mutation. A future receipt of
      // the same payload (after the link surfaces) will be applied normally.
      if (linkedRef === null) {
        await tx.webhookDelivery.update({
          where: { id: delivery.id },
          data: { statusCode, latencyMs, error: "no-link" },
        });
        await tx.webhookConfig.update({
          where: { id: webhookConfigId },
          data: { lastReceivedAt: receivedAt },
        });
        return { outcome: "no-link", deliveryId: delivery.id };
      }

      // Step 4: Pre-INSERT SELECT for prior application of this payload.
      // Doing this BEFORE any branch lets us avoid a try/catch around
      // tx.webhookEventDedup.create — Postgres aborts the tx on P2002 so we
      // cannot recover from a thrown unique-constraint error inside the
      // transaction. The unique constraint still backstops the rare TOCTOU
      // race (two concurrent webhooks both passing the SELECT) — the loser's
      // INSERT throws, the outer catch returns 'error', and the sender's
      // retry resolves cleanly via the now-committed row.
      const priorDedup = await tx.webhookEventDedup.findFirst({
        where: { webhookConfigId, payloadDigest },
        select: { id: true },
      });

      // Outcome is computed via the branch logic below; the SHARED tail at
      // the bottom of the tx finalizes the delivery row + bumps
      // WebhookConfig.lastReceivedAt unconditionally so the admin UI's
      // "last received" timestamp is honest during replay storms — every
      // accepted receipt counts, including duplicates.
      let outcome: TxOutcome;
      let deliveryError: string | null = null;

      // Step 5: Synthetic short-circuit. Dedup is written INSIDE this branch
      // so two synthetic clicks demonstrate the duplicate path.
      if (payload.synthetic) {
        if (priorDedup) {
          deliveryError = "duplicate";
          outcome = { outcome: "duplicate", deliveryId: delivery.id };
        } else {
          await tx.webhookEventDedup.create({
            data: {
              webhookConfigId,
              payloadDigest,
              processedAt: receivedAt,
            },
          });
          deliveryError = "synthetic";
          outcome = { outcome: "synthetic", deliveryId: delivery.id };
        }
      } else {
        // Step 6: Linked-Issue lookup (tenant-scoped). NO `externalSystem`
        // filter — Issue.externalSystem is not a DB column.
        // linkedRef.externalSystem is informational only and surfaces in
        // audit metadata.
        const linkedIssue = await tx.issue.findFirst({
          where: {
            externalKey: linkedRef.externalKey,
            isDeleted: false,
            project: { id: projectId },
          },
          select: { id: true },
        });

        if (!linkedIssue) {
          // Step 7: Linked-via-payload but no local Issue yet — auto-create
          // path. The webhook carries enough info (externalKey + upstream
          // signal that the issue exists) for us to mirror it locally
          // instead of requiring manual import. The post-commit sync calls
          // `performIssueRefreshSystem({ createIfMissing: { projectId } })`
          // which pulls full upstream state and INSERTs a new Issue row.
          //
          // Dedup IS written here (in contrast to the no-link skip-dedup
          // behavior): the auto-create acts on this payload, so a redelivery
          // should resolve as 'duplicate' rather than create again. Failure
          // of the post-commit create logs but does not roll back the dedup
          // row — the next webhook event for the same issue (different
          // digest) will reattempt and reconcile.
          if (priorDedup) {
            deliveryError = "duplicate";
            outcome = { outcome: "duplicate", deliveryId: delivery.id };
          } else {
            await tx.webhookEventDedup.create({
              data: {
                webhookConfigId,
                payloadDigest,
                processedAt: receivedAt,
              },
            });
            deliveryError = null;
            // Auto-create variant: no local Issue at tx-commit time. The
            // post-commit sync mints it; audit records `wasAutoCreated`.
            outcome = {
              outcome: "updated",
              deliveryId: delivery.id,
              issueId: null,
              wasAutoCreated: true,
            };
          }
        } else if (priorDedup) {
          // Step 8a: Already-applied payload — no double-update.
          deliveryError = "duplicate";
          outcome = { outcome: "duplicate", deliveryId: delivery.id };
        } else {
          // Step 8b: First-time linked apply — INSERT dedup row inside the
          // tx (idempotency for HTTP-level retries: Jira/GitHub redelivery
          // sees the dedup hit and returns 'duplicate'). The actual Issue
          // mutation runs AFTER this tx commits via
          // `performIssueRefreshSystem`, which pulls full upstream state
          // and applies the integration's field mappings — equivalent to
          // a manual sync click. Reasoning behind the tx-split:
          //   • Inline-tx field updates were a half-truth — only
          //     externalStatus + lastSyncedAt copied across, leaving
          //     title/assignee/etc. stale until a hover or manual sync.
          //   • The freshness gate in performIssueRefreshSystem
          //     (minFreshnessSeconds=15) coalesces rapid event bursts so
          //     a single Jira edit firing N webhooks doesn't trigger N
          //     API pulls.
          //   • Sync failure is recoverable: the next webhook event (with
          //     a different payloadDigest) bypasses dedup and re-attempts.
          await tx.webhookEventDedup.create({
            data: {
              webhookConfigId,
              payloadDigest,
              processedAt: receivedAt,
            },
          });
          deliveryError = null;
          outcome = {
            outcome: "updated",
            deliveryId: delivery.id,
            issueId: linkedIssue.id,
          };
        }
      }

      // Shared tail: finalize delivery row + bump lastReceivedAt for ALL
      // outcomes. lastReceivedAt reflects every successful HTTP receipt,
      // not just the non-duplicate first-time applies.
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: { statusCode, latencyMs, error: deliveryError },
      });
      await tx.webhookConfig.update({
        where: { id: webhookConfigId },
        data: { lastReceivedAt: receivedAt },
      });
      return outcome;
    });
  } catch (err) {
    // Any throw inside the transaction rolls back. No delivery, no dedup, no audit.
    return {
      outcome: "error",
      reason: truncate(err instanceof Error ? err.message : String(err)),
    };
  }

  // Audit emission AFTER tx commits. Awaited — no fire-and-forget.
  // adapterType in audit metadata is the parametrized value, not a hardcoded
  // literal — every accepted receipt is forensically attributable to the
  // resolved adapter regardless of source system.
  const baseMetadata: Record<string, unknown> = {
    adapterType: adapterType,
    eventType: eventType,
    payloadDigest,
    webhookConfigId,
    outcome: txResult.outcome,
  };
  if (txResult.outcome === "updated") {
    if (txResult.issueId !== null) {
      baseMetadata.issueId = txResult.issueId;
    }
    if (txResult.wasAutoCreated) {
      baseMetadata.wasAutoCreated = true;
      // Auto-create cases don't yet have a local issueId at audit time;
      // the externalKey is the only stable identifier until the post-
      // commit sync mints the row.
      baseMetadata.issueKey = linkedRef!.externalKey;
    }
  } else if (txResult.outcome === "no-link" && linkedRef) {
    baseMetadata.issueKey = linkedRef.externalKey;
  }

  await captureAuditEvent({
    action: "WEBHOOK_RECEIVED",
    entityType: "WebhookDelivery",
    entityId: txResult.deliveryId,
    projectId,
    userId: SYSTEM_ACTOR_ID,
    metadata: baseMetadata,
  });

  // Post-commit: trigger a full system-context sync for the linked Issue.
  // Only fires for the 'updated' outcome — that's the path where a fresh
  // dedup row was just written, signalling intent to apply upstream
  // changes. Other outcomes (no-link, no_handler, duplicate, synthetic)
  // explicitly skip syncing.
  //
  // Auto-create variant: if the local Issue doesn't exist yet (`wasAutoCreated`
  // flag), the sync uses `createIfMissing: { projectId }` so the system path
  // INSERTs a new Issue row populated from upstream state.
  //
  // Defensive try/catch: the dedup row is already committed at this point.
  // Any throw here would propagate to the route handler and surface as a
  // 500 to the upstream sender (Jira / GitHub / ADO), which would then
  // retry — and the retry would hit the dedup row and resolve as
  // 'duplicate' without re-attempting the sync. That leaves the local
  // Issue permanently un-created. Better to log + drop the throw; the
  // next webhook event for this issue (different payloadDigest) will
  // retry the sync naturally.
  if (txResult.outcome === "updated" && linkedRef) {
    try {
      await triggerSystemSyncForInboundEvent({
        projectId,
        adapterType,
        externalKey: linkedRef.externalKey,
        createIfMissing: txResult.wasAutoCreated === true,
      });
    } catch (err) {
      console.error(
        `[applyInboundIssueUpdate] post-commit sync trigger threw for ${linkedRef.externalKey}:`,
        err
      );
    }
  }

  // Map TxOutcome to public ApplyInboundIssueUpdateResult.
  switch (txResult.outcome) {
    case "updated":
      return {
        outcome: "updated",
        deliveryId: txResult.deliveryId,
        // Auto-create case: issueId is null at audit time (the Issue was
        // minted post-commit). The public type allows omitting it.
        ...(txResult.issueId !== null ? { issueId: txResult.issueId } : {}),
      };
    case "no-link":
      return {
        outcome: "no-link",
        deliveryId: txResult.deliveryId,
        reason: "no-link",
      };
    case "no_handler":
      return {
        outcome: "no_handler",
        deliveryId: txResult.deliveryId,
        reason: "no_handler",
      };
    case "duplicate":
      return {
        outcome: "duplicate",
        deliveryId: txResult.deliveryId,
        reason: "duplicate",
      };
    case "synthetic":
      return {
        outcome: "synthetic",
        deliveryId: txResult.deliveryId,
        reason: "synthetic",
      };
  }
}
