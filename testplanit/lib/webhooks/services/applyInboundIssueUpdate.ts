import { SYSTEM_ACTOR_ID } from "~/lib/auditContext";
import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getAdapter } from "~/lib/webhooks/adapters";

import type {
  ApplyInboundIssueUpdateInput,
  ApplyInboundIssueUpdateResult,
} from "./types";

const REASON_MAX_LEN = 500;

function truncate(s: string): string {
  return s.length > REASON_MAX_LEN ? s.slice(0, REASON_MAX_LEN) : s;
}

/**
 * Domain entry point for the inbound webhook receiver — adapter-agnostic.
 *
 * Renamed in Phase 3 P-02 from `applyJiraIssueUpdate` per CONTEXT D-01.
 * The service is now parametrized by `adapterType` and is the single owner
 * of the adapter→extractor relationship for inbound flows: the receiver
 * hands over `{ adapterType, eventType, payload, ... }` and this service
 * itself calls `getAdapter(adapterType).extractLinkedIssueRef(payload)` +
 * `.extractExternalStatus(payload, eventType)` (RESEARCH.md Q2 RESOLVED —
 * service-side delegation; the route handler does NOT re-parse rawBody and
 * does NOT call adapter extractors directly).
 *
 * 3-model architecture (BLOCKER #1 / D-03 REVISED / D-04 REVISED):
 *   - WebhookDelivery: every HTTP receive gets a row (delivery LOG).
 *   - WebhookEventDedup: idempotency tracker; @@unique([webhookConfigId, payloadDigest]).
 *
 * Dedup is written ONLY when the payload would actually be applied (synthetic
 * short-circuit OR linked-Issue branch). The no-link, no_handler, and
 * no-link-upfront branches never touch the dedup table — no INSERT, no DELETE
 * — which preserves D-14 retry-after-link semantics without serializing on
 * the dedup row during the no-link lifetime.
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
 *   4. If externalStatus === null → no_handler skip (D-15): finalize delivery
 *      row with error='no_handler', bump lastReceivedAt, return 'no_handler'.
 *      Dedup never touched. Issue lookup never performed.
 *   5. If linkedRef === null → no-link-upfront skip: finalize delivery row
 *      with error='no-link', bump lastReceivedAt, return 'no-link'. Dedup
 *      never touched. Issue lookup never performed.
 *   6. SELECT WebhookEventDedup to detect a prior application of this payload.
 *   7. If payload.synthetic (D-20):
 *        - Existing dedup row → finalize delivery error='duplicate',
 *          return 'duplicate'. (SC#5 demo lock: second synthetic click.)
 *        - No prior row → INSERT dedup, finalize delivery error='synthetic',
 *          return 'synthetic'.
 *   8. Otherwise look up linked Issue (tenant-scoped to projectId — T-03-01).
 *      D-22 invariant: where clause filters by externalKey + projectId +
 *      isDeleted=false ONLY. NO `externalSystem` filter — Issue.externalSystem
 *      is NOT a DB column; linkedRef.externalSystem is informational metadata.
 *   9. No linked Issue (D-14) → finalize delivery error='no-link', return
 *      'no-link'. Dedup never touched.
 *  10. Linked Issue:
 *        - Existing dedup row → finalize delivery error='duplicate',
 *          return 'duplicate' (WBHK-06). No Issue mutation.
 *        - No prior row → INSERT dedup, update Issue.externalStatus +
 *          Issue.lastSyncedAt, finalize delivery error=null, return 'updated'.
 *
 * Shared tail (every accepted receipt): bump WebhookConfig.lastReceivedAt
 * (ME-01 — every accepted receipt counts, including duplicates).
 *
 * After tx commit: emit WEBHOOK_RECEIVED audit (D-16, D-17). actor='__system__'.
 * Audit emission is awaited (Phase 63 REL-01 — no fire-and-forget) — the
 * captureAuditEvent helper enqueues onto BullMQ and returns quickly.
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

  // T-03-14 mitigation: adapter is resolved from `input.adapterType` (sourced
  // by the receiver from the verified WebhookConfig row), NOT from any
  // wire-controlled body field. An attacker cannot smuggle an adapter
  // selection in the request body.
  const adapter = getAdapter(adapterType);
  const linkedRef = adapter.extractLinkedIssueRef(payload);
  const externalStatus = adapter.extractExternalStatus(payload, eventType);

  type TxOutcome =
    | { outcome: "updated"; deliveryId: string; issueId: number }
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

      // Step 2: D-15 no_handler skip — adapter declined to extract a status
      // for this eventType (e.g. GitHub `push`, ADO `build.complete`). Write
      // the delivery row with error='no_handler', skip dedup + Issue lookup
      // entirely. T-03-12 mitigation: minimal DB work for unsupported events.
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
      // "last received" timestamp is honest during replay storms (ME-01 —
      // every accepted receipt counts, including duplicates).
      let outcome: TxOutcome;
      let deliveryError: string | null = null;

      // Step 5: Synthetic short-circuit (D-20). Dedup is written INSIDE this
      // branch so two synthetic clicks demonstrate the duplicate path (SC#5).
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
        // Step 6: Linked-Issue lookup (tenant-scoped — T-03-01).
        // D-22 invariant: NO `externalSystem` filter — Issue.externalSystem is
        // not a DB column. linkedRef.externalSystem is informational only and
        // surfaces in audit metadata (T-03-13).
        const linkedIssue = await tx.issue.findFirst({
          where: {
            externalKey: linkedRef.externalKey,
            isDeleted: false,
            project: { id: projectId },
          },
          select: { id: true },
        });

        if (!linkedIssue) {
          // Step 7: No-link path (D-14). Dedup table is NEVER touched in this
          // branch — no INSERT, no DELETE — so a future receipt of the same
          // payload (after a link is created) can be applied normally.
          deliveryError = "no-link";
          outcome = { outcome: "no-link", deliveryId: delivery.id };
        } else if (priorDedup) {
          // Step 8a: Already-applied payload — no double-update (WBHK-06).
          deliveryError = "duplicate";
          outcome = { outcome: "duplicate", deliveryId: delivery.id };
        } else {
          // Step 8b: First-time linked apply — INSERT dedup + update Issue.
          await tx.webhookEventDedup.create({
            data: {
              webhookConfigId,
              payloadDigest,
              processedAt: receivedAt,
            },
          });
          await tx.issue.update({
            where: { id: linkedIssue.id },
            data: {
              externalStatus: externalStatus,
              lastSyncedAt: receivedAt,
              // D-10: deliberately NOT touching Issue.status (internal normalized status).
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
      // outcomes (ME-01). lastReceivedAt reflects every successful HTTP
      // receipt, not just the non-duplicate first-time applies.
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
    // D-11: any throw inside the transaction rolls back. No delivery, no dedup, no audit.
    return {
      outcome: "error",
      reason: truncate(err instanceof Error ? err.message : String(err)),
    };
  }

  // Audit emission AFTER tx commits (D-11). Awaited (Phase 63 REL-01 — no fire-and-forget).
  // T-03-13 mitigation: adapterType in audit metadata is the parametrized value,
  // not a hardcoded literal — every accepted receipt is forensically attributable
  // to the resolved adapter regardless of source system.
  const baseMetadata: Record<string, unknown> = {
    adapterType: adapterType,
    eventType: eventType,
    payloadDigest,
    webhookConfigId,
    outcome: txResult.outcome,
  };
  if (txResult.outcome === "updated") {
    baseMetadata.issueId = txResult.issueId;
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

  // Map TxOutcome to public ApplyInboundIssueUpdateResult.
  switch (txResult.outcome) {
    case "updated":
      return {
        outcome: "updated",
        deliveryId: txResult.deliveryId,
        issueId: txResult.issueId,
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
