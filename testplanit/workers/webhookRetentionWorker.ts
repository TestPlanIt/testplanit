import { prisma } from "../lib/prisma";
import { SYSTEM_ACTOR_ID } from "../lib/auditContext";
import { captureAuditEvent } from "../lib/services/auditLog";

/**
 * webhook retention worker.
 *
 * Polled-loop standalone process. Wakes once per day, calls purgeOnce(),
 * sleeps until the next scheduled hour. Three purges per pass:
 *   1. WebhookDelivery rows where receivedAt < (now - 30 days)
 *   2. WebhookEventDedup rows where processedAt < (now - 30 days)
 *      (column is processedAt per schema.zmodel:3591 — pass-1 fix lock)
 *   3. WebhookOutboxEvent rows where dispatchedAt IS NOT NULL
 *      AND dispatchedAt < (now - 30 days). Un-dispatched (in-flight) rows
 *      always survive.
 *
 * Each table uses batched LIMIT 1000 deletes via `prisma.$executeRaw` (loop
 * until $executeRaw returns 0 rows affected) to avoid lock contention on
 * large retention tables. The `WHERE id IN (SELECT id ... LIMIT 1000)`
 * pattern is the standard Postgres idiom for batched deletes — `LIMIT` is
 * illegal in Postgres `DELETE` directly, but legal in the inner subquery.
 *
 * One audit row per run with totals + duration so operators can answer
 * "did purge run last night, and how much was deleted?".
 */

const RETENTION_DAYS = 30;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// 24h cadence — wake once per day, run purgeOnce(), sleep again.
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface PurgeResult {
  webhookDeliveryRows: number;
  webhookEventDedupRows: number;
  webhookOutboxEventRows: number;
  durationMs: number;
}

let stopRequested = false;
let inflight: Promise<PurgeResult> | null = null;

async function batchedDeleteWebhookDelivery(cutoff: Date): Promise<number> {
  let total = 0;
  while (true) {
    const rowsAffected = await prisma.$executeRaw`
      DELETE FROM "WebhookDelivery"
      WHERE id IN (
        SELECT id FROM "WebhookDelivery"
        WHERE "receivedAt" < ${cutoff}
        LIMIT 1000
      )
    `;
    const n = Number(rowsAffected); // bigint→number safe for batch ≤ 1000
    total += n;
    if (n === 0) break;
  }
  return total;
}

async function batchedDeleteWebhookEventDedup(cutoff: Date): Promise<number> {
  let total = 0;
  while (true) {
    const rowsAffected = await prisma.$executeRaw`
      DELETE FROM "WebhookEventDedup"
      WHERE id IN (
        SELECT id FROM "WebhookEventDedup"
        WHERE "processedAt" < ${cutoff}
        LIMIT 1000
      )
    `;
    const n = Number(rowsAffected);
    total += n;
    if (n === 0) break;
  }
  return total;
}

async function batchedDeleteWebhookOutboxEvent(cutoff: Date): Promise<number> {
  let total = 0;
  while (true) {
    const rowsAffected = await prisma.$executeRaw`
      DELETE FROM "WebhookOutboxEvent"
      WHERE id IN (
        SELECT id FROM "WebhookOutboxEvent"
        WHERE "dispatchedAt" IS NOT NULL
          AND "dispatchedAt" < ${cutoff}
        LIMIT 1000
      )
    `;
    const n = Number(rowsAffected);
    total += n;
    if (n === 0) break;
  }
  return total;
}

export async function purgeOnce(): Promise<PurgeResult> {
  const startedAt = Date.now();
  const cutoff = new Date(startedAt - RETENTION_MS);

  const webhookDeliveryRows = await batchedDeleteWebhookDelivery(cutoff);
  console.log(
    `[WebhookRetention] purged ${webhookDeliveryRows} WebhookDelivery rows (cutoff=${cutoff.toISOString()})`
  );

  const webhookEventDedupRows = await batchedDeleteWebhookEventDedup(cutoff);
  console.log(
    `[WebhookRetention] purged ${webhookEventDedupRows} WebhookEventDedup rows`
  );

  const webhookOutboxEventRows = await batchedDeleteWebhookOutboxEvent(cutoff);
  console.log(
    `[WebhookRetention] purged ${webhookOutboxEventRows} WebhookOutboxEvent rows`
  );

  const durationMs = Date.now() - startedAt;
  await captureAuditEvent({
    action: "WEBHOOK_RETENTION_PURGED",
    entityType: "WebhookDelivery",
    entityId: `retention-${cutoff.toISOString()}`,
    userId: SYSTEM_ACTOR_ID,
    metadata: {
      retentionDays: RETENTION_DAYS,
      webhookDeliveryRows,
      webhookEventDedupRows,
      webhookOutboxEventRows,
      durationMs,
      cutoff: cutoff.toISOString(),
    },
  });

  return {
    webhookDeliveryRows,
    webhookEventDedupRows,
    webhookOutboxEventRows,
    durationMs,
  };
}

export async function startLoop(): Promise<void> {
  console.log(
    `[WebhookRetention] Starting daily retention loop (cadence=${POLL_INTERVAL_MS}ms)`
  );
  while (!stopRequested) {
    try {
      inflight = purgeOnce();
      await inflight;
    } catch (err) {
      console.error("[WebhookRetention] Purge error:", err);
    } finally {
      inflight = null;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.log("[WebhookRetention] Retention loop exited");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[WebhookRetention] Received ${signal}, shutting down...`);
  stopRequested = true;
  if (inflight) {
    try {
      await inflight;
    } catch {
      // Ignore — startLoop catches purge errors
    }
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch(() => process.exit(1));
});

if (require.main === module) {
  console.log("[WebhookRetention] Running as standalone process...");
  startLoop().catch((err) => {
    console.error("[WebhookRetention] Loop failed:", err);
    process.exit(1);
  });
}
