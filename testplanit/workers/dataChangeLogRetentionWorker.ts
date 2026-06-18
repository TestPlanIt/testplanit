import type { PrismaClient } from "@prisma/client";

import { SYSTEM_ACTOR_ID } from "../lib/auditContextConstants";
import { prisma } from "../lib/prismaBase";
import { captureAuditEvent } from "../lib/services/auditLog";

/**
 * DataChangeLog retention worker.
 *
 * Polled-loop standalone process. Wakes once per day, calls purgeOnce(),
 * sleeps until the next pass. Batched-deletes DataChangeLog rows where:
 *   processed = true AND ts < now() - RETENTION_DAYS
 *
 * Unprocessed rows (processed = false) are NEVER deleted — the append-only
 * trigger (datachangelog_append_only) enforces this at the DB level too, so
 * a future code bug that omits the filter still hits RAISE 42501 insufficient_privilege.
 *
 * The LIMIT-1000 subquery pattern avoids a single giant DELETE locking the
 * table and starving the capture path — identical idiom to webhookRetentionWorker.
 *
 * Uses the raw prismaBase client (bypasses @@deny('all', true)) — the same
 * raw-client pattern the correlation worker uses for DataChangeLog access.
 */

/** Fixed 30-day retention window (ROADMAP success criterion 2 — do NOT make env-configurable). */
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Wake once per day. */
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface PurgeResult {
  dataChangeLogRows: number;
  durationMs: number;
}

let stopRequested = false;
let inflight: Promise<unknown> | null = null;

export async function purgeOnce(client: PrismaClient = prisma): Promise<PurgeResult> {
  const startedAt = Date.now();
  const cutoff = new Date(startedAt - RETENTION_MS);

  let total = 0;
  while (true) {
    const rowsAffected = await client.$executeRaw`
      DELETE FROM "DataChangeLog"
      WHERE id IN (
        SELECT id FROM "DataChangeLog"
        WHERE processed = true
          AND ts < ${cutoff}
        ORDER BY id
        LIMIT 1000
      )
    `;
    const n = Number(rowsAffected);
    total += n;
    if (n === 0) break;
  }

  const durationMs = Date.now() - startedAt;

  console.log(
    `[DataChangeLogRetention] purged ${total} DataChangeLog rows (cutoff=${cutoff.toISOString()}, durationMs=${durationMs})`
  );

  await captureAuditEvent({
    action: "DCL_RETENTION_PURGED",
    entityType: "DataChangeLog",
    entityId: `retention-${cutoff.toISOString()}`,
    userId: SYSTEM_ACTOR_ID,
    metadata: {
      retentionDays: RETENTION_DAYS,
      dataChangeLogRows: total,
      durationMs,
      cutoff: cutoff.toISOString(),
    },
  });

  return { dataChangeLogRows: total, durationMs };
}

export async function startLoop(): Promise<void> {
  console.log(
    `[DataChangeLogRetention] Starting daily retention loop (cadence=${POLL_INTERVAL_MS}ms, retentionDays=${RETENTION_DAYS})`
  );
  while (!stopRequested) {
    try {
      inflight = purgeOnce();
      await inflight;
    } catch (err) {
      console.error("[DataChangeLogRetention] Purge error:", err);
    } finally {
      inflight = null;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.log("[DataChangeLogRetention] Retention loop exited");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[DataChangeLogRetention] Received ${signal}, shutting down...`);
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
  console.log("[DataChangeLogRetention] Running as standalone process...");
  startLoop().catch((err) => {
    console.error("[DataChangeLogRetention] Loop failed:", err);
    process.exit(1);
  });
}
