import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Outbound webhook outbox helpers.
 *
 * `claimOutboxBatch` issues a Postgres CTE that SELECTs unsent rows under
 * `FOR UPDATE SKIP LOCKED` and UPDATEs `dispatchedAt = NOW()` in the SAME
 * statement. Multiple worker replicas can run this concurrently without
 * double-claiming.
 *
 * `fanoutToConfigs` resolves one claimed row to N matching outbound
 * WebhookConfig rows using Prisma's `text[]` operators (`isEmpty` for
 * subscribe-all, `has` for exact-string match).
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
 * Atomic batch claim using FOR UPDATE SKIP LOCKED. Multiple worker
 * replicas can run this concurrently without double-claiming. The CTE sets
 * dispatchedAt = NOW() in the SAME statement as the SELECT, so a crashed
 * replica that claims rows but dies before enqueueing dispatch jobs DOES
 * lose those events (enqueue-before-claim is the only way to guarantee
 * at-least-once enqueue, but that risks at-least-twice; we accept rare
 * event loss here in exchange for at-most-once enqueue. The admin replay
 * UI is the recovery path).
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
 * Fan-out: given one claimed outbox row, find every active outbound
 * WebhookConfig in the same project that subscribes to this event.
 *
 * Subscription semantics:
 *   - subscribedEvents = []  ⟶ subscribe-all
 *   - subscribedEvents non-empty ⟶ exact-string match required
 *   - No wildcard support
 *
 * Targeted dispatch for `webhook.test`: the synthetic test event from
 * sendTestOutboundWebhook carries the originating `configId` in its
 * payload. Bypass subscription matching and target exactly that config —
 * the admin explicitly clicked "Send test event" on it.
 *
 * Prisma's `text[]` `has` operator generates SQL `'<value>' = ANY("subscribedEvents")`;
 * `isEmpty` generates `cardinality("subscribedEvents") = 0`.
 */
export async function fanoutToConfigs(
  row: Pick<ClaimedOutboxEvent, "projectId" | "eventName" | "payload">,
  prisma: PrismaClient | Prisma.TransactionClient
): Promise<string[]> {
  if (row.eventName === "webhook.test") {
    const targetConfigId =
      row.payload &&
      typeof row.payload === "object" &&
      !Array.isArray(row.payload)
        ? (row.payload as { configId?: unknown }).configId
        : undefined;
    if (typeof targetConfigId !== "string") return [];
    const config = await prisma.webhookConfig.findUnique({
      where: { id: targetConfigId },
      select: { id: true, projectId: true, direction: true, isActive: true },
    });
    if (
      !config ||
      config.projectId !== row.projectId ||
      config.direction !== "OUTBOUND" ||
      !config.isActive
    ) {
      return [];
    }
    return [config.id];
  }

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
