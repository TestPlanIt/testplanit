import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "~/lib/prisma";
import { getWebhookDispatchQueue } from "~/lib/queues";
import { captureAuditEvent } from "~/lib/services/auditLog";

/**
 * Webhook replay service.
 *
 * OUTBOUND-ONLY. Inbound replay is deferred to a future release:
 *   - We store `payloadDigest` (a hash) on inbound `WebhookDelivery` rows,
 *     not the raw body.
 *   - Competitor research showed neither Qase nor TestRail offer replay UI;
 *     Stripe + GitHub offer outbound replay only.
 *
 * Used by the admin replay UI via server actions.
 *
 * Outbound chain: load `WebhookDelivery` → if INBOUND, reject; if OUTBOUND,
 * load the original `WebhookOutboxEvent` via the
 * `WebhookDelivery.eventId → WebhookOutboxEvent.eventId @unique` link →
 * enqueue a fresh `webhookDispatchQueue` job with the original payload +
 * `replayedFromDeliveryId` threaded into job data. The dispatch worker
 * writes the new delivery row at attempt-completion time.
 */

export const BULK_REPLAY_HARD_CAP = 100;

export type ReplayRejectionReason =
  | "inbound_replay_not_supported" // inbound rejected at helper boundary
  | "delivery_not_found"
  | "outbox_purged" // outbound delivery's eventId points at a purged WebhookOutboxEvent (or null eventId on legacy rows)
  | "config_deleted" // delivery row is an orphaned audit record — its WebhookConfig was hard-deleted (schema.zmodel: webhookConfig SetNull)
  | "exceeds_cap"; // bulk-only hard cap

export interface ReplayOptions {
  actorUserId: string;
  source: "single" | "bulk";
  batchId?: string;
}

export type ReplayResult =
  | { outcome: "queued"; queueJobId: string }
  | { outcome: "rejected"; reason: ReplayRejectionReason };

export async function replayDelivery(
  originalDeliveryId: string,
  opts: ReplayOptions,
  prisma: PrismaClient | Prisma.TransactionClient = defaultPrisma
): Promise<ReplayResult> {
  // 1. Load the original delivery row + projectId from the related WebhookConfig.
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: originalDeliveryId },
    select: {
      id: true,
      direction: true,
      eventId: true,
      webhookConfigId: true,
      webhookConfig: { select: { projectId: true, adapterType: true } },
    },
  });
  if (!delivery) {
    return { outcome: "rejected", reason: "delivery_not_found" };
  }

  // 2. Orphaned audit row — the WebhookConfig has been hard-deleted (admin
  //    pressed Delete in the UI). The delivery row survived per the
  //    SetNull FK so the audit trail is preserved, but there is no live
  //    config to dispatch against. Reject with a typed reason BEFORE the
  //    direction branch so both INBOUND and OUTBOUND orphans surface the
  //    same `config_deleted` signal to admins.
  if (delivery.webhookConfigId === null || delivery.webhookConfig === null) {
    return { outcome: "rejected", reason: "config_deleted" };
  }

  // 3. Inbound is rejected at the helper boundary. No audit, no stub row,
  //    no service call. The admin UI renders a gray info banner for
  //    inbound rows instead of a Replay button.
  if (delivery.direction === "INBOUND") {
    return { outcome: "rejected", reason: "inbound_replay_not_supported" };
  }

  // 4. OUTBOUND path. Load the source WebhookOutboxEvent by eventId so we
  //    can re-enqueue dispatch with the original payload. The link relies
  //    on the @unique on WebhookOutboxEvent.eventId.
  if (!delivery.eventId) {
    // Defensive: legacy rows from before eventId-threading. Surfaced as
    // outbox_purged so the admin sees a consistent rejection reason in the
    // UI rather than a separate sentinel.
    return { outcome: "rejected", reason: "outbox_purged" };
  }

  const outbox = await prisma.webhookOutboxEvent.findUnique({
    where: { eventId: delivery.eventId },
    select: { id: true, payload: true, eventName: true },
  });
  if (!outbox) {
    return { outcome: "rejected", reason: "outbox_purged" };
  }

  // 5. Enqueue the dispatch job with replayedFromDeliveryId threaded in.
  //    jobId pattern: `replay--<originalDeliveryId>--<timestamp>` so the
  //    same row can be replayed multiple times without BullMQ jobId collision.
  const queue = getWebhookDispatchQueue();
  const jobId = `replay--${delivery.id}--${Date.now()}`;
  await queue?.add(
    "dispatch",
    {
      webhookConfigId: delivery.webhookConfigId,
      outboxEventId: outbox.id,
      eventId: delivery.eventId,
      attempt: 1,
      replayedFromDeliveryId: delivery.id,
    },
    { jobId }
  );

  // 6. Audit. Outbound success path only — inbound rejection above already
  //    returned without emitting. The new replay row is written by the
  //    dispatch worker at attempt-completion time, so `replayDeliveryId`
  //    is null at this point; the worker's own WEBHOOK_DISPATCHED audit
  //    ties the chain together via metadata.
  await captureAuditEvent({
    action: "WEBHOOK_REPLAYED",
    entityType: "WebhookDelivery",
    entityId: delivery.id,
    projectId: delivery.webhookConfig.projectId,
    userId: opts.actorUserId,
    metadata: {
      webhookConfigId: delivery.webhookConfigId,
      originalDeliveryId: delivery.id,
      replayDeliveryId: null,
      actorUserId: opts.actorUserId,
      source: opts.source,
      ...(opts.source === "bulk" ? { batchId: opts.batchId } : {}),
    },
  });

  return { outcome: "queued", queueJobId: jobId };
}

export interface BulkReplayResult {
  outcome: "queued" | "rejected";
  reason?: ReplayRejectionReason;
  batchId?: string;
  enqueuedCount?: number;
  skippedInboundCount?: number;
}

/**
 * Bulk replay wrapper. The server action is the primary inbound filter —
 * it pre-filters the SELECT to `direction = "OUTBOUND"` so this helper
 * rarely sees inbound IDs in the bulk path. `skippedInboundCount` is the
 * defense-in-depth signal for cases where the filter is bypassed.
 */
export async function bulkReplayDeliveries(
  deliveryIds: string[],
  opts: Omit<ReplayOptions, "source" | "batchId">,
  prisma: PrismaClient | Prisma.TransactionClient = defaultPrisma
): Promise<BulkReplayResult> {
  if (deliveryIds.length > BULK_REPLAY_HARD_CAP) {
    return { outcome: "rejected", reason: "exceeds_cap" };
  }
  const batchId = `bat_${randomUUID()}`;
  let enqueuedCount = 0;
  let skippedInboundCount = 0;
  for (const id of deliveryIds) {
    const r = await replayDelivery(
      id,
      { ...opts, source: "bulk", batchId },
      prisma
    );
    if (r.outcome === "queued") {
      enqueuedCount += 1;
    } else if (r.reason === "inbound_replay_not_supported") {
      skippedInboundCount += 1;
    }
  }
  return { outcome: "queued", batchId, enqueuedCount, skippedInboundCount };
}
