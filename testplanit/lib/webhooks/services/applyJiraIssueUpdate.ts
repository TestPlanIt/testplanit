import { SYSTEM_ACTOR_ID } from "~/lib/auditContext";
import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { isUniqueConstraintError } from "~/lib/utils/errors";

import type {
  ApplyJiraIssueUpdateInput,
  ApplyJiraIssueUpdateResult,
} from "./types";

const REASON_MAX_LEN = 500;

function truncate(s: string): string {
  return s.length > REASON_MAX_LEN ? s.slice(0, REASON_MAX_LEN) : s;
}

/**
 * Domain entry point for the inbound Jira webhook receiver.
 *
 * 3-model architecture (BLOCKER #1 / D-03 REVISED / D-04 REVISED):
 *   - WebhookDelivery: every HTTP receive gets a row (delivery LOG).
 *   - WebhookEventDedup: idempotency tracker; @@unique([webhookConfigId, payloadDigest]).
 *
 * Dedup is written ONLY when the payload would actually be applied (synthetic
 * short-circuit OR linked-Issue branch). The no-link branch never touches the
 * dedup table — no INSERT, no DELETE — which preserves D-14 retry-after-link
 * semantics without serializing on the dedup row during the no-link lifetime.
 *
 * Flow inside the transaction:
 *   1. Always INSERT a WebhookDelivery row (delivery log entry).
 *   2. If payload.synthetic (D-20): try INSERT WebhookEventDedup.
 *        - On P2002: finalize delivery row error='duplicate', return 'duplicate'.
 *          (SC#5 demo lock: a second synthetic click for the same payloadDigest
 *          collides with the first click's dedup row.)
 *        - On success: finalize delivery row error='synthetic', update
 *          WebhookConfig.lastReceivedAt, return 'synthetic'. Issue lookup and
 *          mutation are skipped entirely.
 *   3. Otherwise look up linked Issue (tenant-scoped to projectId — T-03-01).
 *   4. If no linked Issue (D-14): finalize delivery row error='no-link', update
 *      WebhookConfig.lastReceivedAt, return 'no-link'. Dedup table untouched.
 *   5. If linked Issue: try INSERT WebhookEventDedup.
 *        - On P2002 (WBHK-06): finalize delivery row error='duplicate',
 *          return 'duplicate'. No Issue mutation.
 *        - On success: update Issue.externalStatus + Issue.lastSyncedAt, update
 *          WebhookConfig.lastReceivedAt, finalize delivery row error=null,
 *          return 'updated'.
 *
 * After tx commit: emit WEBHOOK_RECEIVED audit (D-16, D-17). actor='__system__'.
 * Audit emission is awaited (Phase 63 REL-01 — no fire-and-forget) — the
 * captureAuditEvent helper enqueues onto BullMQ and returns quickly.
 */
export async function applyJiraIssueUpdate(
  input: ApplyJiraIssueUpdateInput
): Promise<ApplyJiraIssueUpdateResult> {
  const {
    webhookConfigId,
    projectId,
    payload,
    payloadDigest,
    receivedAt,
    latencyMs,
    statusCode,
  } = input;

  type TxOutcome =
    | { outcome: "updated"; deliveryId: string; issueId: number }
    | { outcome: "no-link"; deliveryId: string }
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
          adapterType: "JIRA",
          eventType: payload.eventType,
          statusCode: null,
          latencyMs: null,
          payloadDigest,
          error: null,
          attempt: 1,
          receivedAt,
        },
      });

      // Step 2: Synthetic short-circuit (D-20). Dedup INSERT lives INSIDE this
      // branch so two synthetic clicks demonstrate the duplicate path (SC#5 lock).
      if (payload.synthetic) {
        try {
          await tx.webhookEventDedup.create({
            data: {
              webhookConfigId,
              payloadDigest,
              processedAt: receivedAt,
            },
          });
        } catch (err) {
          if (isUniqueConstraintError(err)) {
            // Second synthetic click for the same payloadDigest.
            await tx.webhookDelivery.update({
              where: { id: delivery.id },
              data: { statusCode, latencyMs, error: "duplicate" },
            });
            return { outcome: "duplicate", deliveryId: delivery.id };
          }
          throw err; // non-P2002 → caller maps to "error"
        }

        await tx.webhookDelivery.update({
          where: { id: delivery.id },
          data: { statusCode, latencyMs, error: "synthetic" },
        });
        await tx.webhookConfig.update({
          where: { id: webhookConfigId },
          data: { lastReceivedAt: receivedAt },
        });
        return { outcome: "synthetic", deliveryId: delivery.id };
      }

      // Step 3: Linked-Issue lookup (tenant-scoped — T-03-01).
      const linkedIssue = await tx.issue.findFirst({
        where: {
          externalKey: payload.issueKey,
          isDeleted: false,
          project: { id: projectId },
        },
        select: { id: true },
      });

      // Step 4: No-link path (D-14). Dedup table is NEVER touched in this branch
      // — no INSERT, no DELETE — so a future receipt of the same payload (after
      // a link is created) can be applied normally.
      if (!linkedIssue) {
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

      // Step 5: Linked-Issue branch. Dedup INSERT first (idempotency); on success
      // apply externalStatus + lastSyncedAt (D-09 + WARNING #11 convergence with
      // polling-sync freshness indicator).
      try {
        await tx.webhookEventDedup.create({
          data: {
            webhookConfigId,
            payloadDigest,
            processedAt: receivedAt,
          },
        });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          // WBHK-06: same payloadDigest already applied → no double-update.
          await tx.webhookDelivery.update({
            where: { id: delivery.id },
            data: { statusCode, latencyMs, error: "duplicate" },
          });
          return { outcome: "duplicate", deliveryId: delivery.id };
        }
        throw err; // non-P2002 → caller maps to "error"
      }

      await tx.issue.update({
        where: { id: linkedIssue.id },
        data: {
          externalStatus: payload.externalStatus,
          lastSyncedAt: receivedAt,
          // D-10: deliberately NOT touching Issue.status (internal normalized status).
        },
      });
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: { statusCode, latencyMs, error: null },
      });
      await tx.webhookConfig.update({
        where: { id: webhookConfigId },
        data: { lastReceivedAt: receivedAt },
      });
      return {
        outcome: "updated",
        deliveryId: delivery.id,
        issueId: linkedIssue.id,
      };
    });
  } catch (err) {
    // D-11: any throw inside the transaction rolls back. No delivery, no dedup, no audit.
    return {
      outcome: "error",
      reason: truncate(err instanceof Error ? err.message : String(err)),
    };
  }

  // Audit emission AFTER tx commits (D-11). Awaited (Phase 63 REL-01 — no fire-and-forget).
  const baseMetadata: Record<string, unknown> = {
    adapterType: "JIRA",
    eventType: payload.eventType,
    payloadDigest,
    webhookConfigId,
    outcome: txResult.outcome,
  };
  if (txResult.outcome === "updated") {
    baseMetadata.issueId = txResult.issueId;
  } else if (txResult.outcome === "no-link") {
    baseMetadata.issueKey = payload.issueKey;
  }

  await captureAuditEvent({
    action: "WEBHOOK_RECEIVED",
    entityType: "WebhookDelivery",
    entityId: txResult.deliveryId,
    projectId,
    userId: SYSTEM_ACTOR_ID,
    metadata: baseMetadata,
  });

  // Map TxOutcome to public ApplyJiraIssueUpdateResult.
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
