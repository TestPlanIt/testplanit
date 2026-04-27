import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * v0.23.0 Phase 2 (D-02 / D-33) — outbound webhook outbox helpers.
 *
 * `claimOutboxBatch` issues a Postgres CTE that SELECTs unsent rows under
 * `FOR UPDATE SKIP LOCKED` and UPDATEs `dispatchedAt = NOW()` in the SAME
 * statement. Multiple worker replicas can run this concurrently without
 * double-claiming.
 *
 * `fanoutToConfigs` resolves one claimed row to N matching outbound
 * WebhookConfig rows using Prisma's `text[]` operators (`isEmpty` for
 * subscribe-all, `has` for exact-string match per D-33).
 */

const DEFAULT_CLAIM_BATCH_SIZE = 100;

export interface ClaimedOutboxEvent {
  id: string;
  projectId: number;
  eventName: string;
  eventId: string;
  eventTimestamp: Date;
  actorUserId: string | null;
  payload: Prisma.JsonValue;
  dispatchedAt: Date;
  createdAt: Date;
}

/**
 * D-02 — atomic batch claim using FOR UPDATE SKIP LOCKED. Multiple worker
 * replicas can run this concurrently without double-claiming. The CTE sets
 * dispatchedAt = NOW() in the SAME statement as the SELECT, so a crashed
 * replica that claims rows but dies before enqueueing dispatch jobs DOES
 * lose those events (RESEARCH Pitfall 2: enqueue-before-claim is the only
 * way to guarantee at-least-once enqueue, but that risks at-least-twice;
 * we accept rare event loss here in exchange for at-most-once enqueue.
 * Phase 4's admin replay UI is the recovery path).
 */
export async function claimOutboxBatch(
  prisma: PrismaClient | Prisma.TransactionClient,
  batchSize: number = DEFAULT_CLAIM_BATCH_SIZE
): Promise<ClaimedOutboxEvent[]> {
  const rows = await prisma.$queryRaw<ClaimedOutboxEvent[]>`
    WITH claimed AS (
      SELECT id FROM "WebhookOutboxEvent"
       WHERE "dispatchedAt" IS NULL
       ORDER BY "createdAt" ASC
       LIMIT ${batchSize}
         FOR UPDATE SKIP LOCKED
    )
    UPDATE "WebhookOutboxEvent" e
       SET "dispatchedAt" = NOW()
      FROM claimed c
     WHERE e.id = c.id
    RETURNING e.id, e."projectId", e."eventName", e."eventId",
              e."eventTimestamp", e."actorUserId", e.payload,
              e."dispatchedAt", e."createdAt"
  `;
  return rows;
}

/**
 * D-33 / OUT-19 — fan-out: given one claimed outbox row, find every active
 * outbound WebhookConfig in the same project that subscribes to this event.
 *
 * Subscription semantics (RESEARCH Pitfall 3):
 *   - subscribedEvents = []  ⟶ subscribe-all
 *   - subscribedEvents non-empty ⟶ exact-string match required
 *   - No wildcard support
 *
 * NOTE: The `webhook.test` synthetic event (Plan 02-06) is NOT special-cased
 * here. The poller never sees `webhook.test` rows because Plan 02-06's
 * sendTestOutboundWebhook server action emits the outbox row directly to
 * a SPECIFIC webhookConfigId (it knows which one — the admin clicked the
 * button on a specific config card). The bypass for "webhook.test ignores
 * subscriptions" lives in lib/webhooks/dispatch.ts (Task 4.2 / Blocker 6).
 *
 * Prisma's `text[]` `has` operator generates SQL `'<value>' = ANY("subscribedEvents")`;
 * `isEmpty` generates `cardinality("subscribedEvents") = 0`.
 */
export async function fanoutToConfigs(
  row: Pick<ClaimedOutboxEvent, "projectId" | "eventName">,
  prisma: PrismaClient | Prisma.TransactionClient
): Promise<string[]> {
  const configs = await prisma.webhookConfig.findMany({
    where: {
      projectId: row.projectId,
      direction: "OUTBOUND",
      isActive: true,
      OR: [
        { subscribedEvents: { isEmpty: true } },
        { subscribedEvents: { has: row.eventName } },
      ],
    },
    select: { id: true },
  });
  return configs.map((c) => c.id);
}
