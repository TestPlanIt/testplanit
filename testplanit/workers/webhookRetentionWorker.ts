import type { DbClient } from "~/lib/zenstack";

import { SYSTEM_ACTOR_ID } from "../lib/auditContext";
import {
  disconnectAllTenantClients,
  getAllTenantIds,
  getTenantDbClient,
  isMultiTenantMode,
} from "../lib/multiTenantDb";
import { baseDb } from "../lib/db";
import { captureAuditEvent } from "../lib/services/auditLog";

/**
 * webhook retention worker.
 *
 * Polled-loop standalone process. Wakes once per day, calls purgeOnce(),
 * sleeps until the next scheduled hour. Three purges per pass:
 *   1. WebhookDelivery rows where receivedAt < (now - 30 days)
 *   2. WebhookEventDedup rows where processedAt < (now - 30 days)
 *      (column is processedAt per schema.zmodel WebhookEventDedup model)
 *   3. WebhookOutboxEvent rows where dispatchedAt IS NOT NULL
 *      AND dispatchedAt < (now - 30 days). Un-dispatched (in-flight) rows
 *      always survive.
 *
 * Each table uses batched LIMIT 1000 deletes via `baseDb.$executeRaw` (loop
 * until $executeRaw returns 0 rows affected) to avoid lock contention on
 * large retention tables. The `WHERE id IN (SELECT id ... LIMIT 1000)`
 * pattern is the standard Postgres idiom for batched deletes — `LIMIT` is
 * illegal in Postgres `DELETE` directly, but legal in the inner subquery.
 *
 * Multi-tenant mode: iterates getAllTenantIds() once per cadence and
 * runs purgeOnce against each tenant's database via getTenantDbClient().
 *
 * One audit row per (tenant, run) with totals + duration so operators can
 * answer "did purge run last night, and how much was deleted?".
 */

const RETENTION_DAYS = 30;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// 24h cadence — wake once per day, run purgeAllTenantsOnce(), sleep again.
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Per-tenant time budget. A tenant with a huge first-time backlog could keep
// the LIMIT-1000 batched-delete loop running for hours and starve every other
// tenant on the same worker. Capping at 5 minutes lets us make forward
// progress on every tenant per cycle; whatever rows remain get cleaned up on
// the next daily pass.
const TENANT_PURGE_BUDGET_MS = 5 * 60 * 1000;

export interface PurgeResult {
  webhookDeliveryRows: number;
  webhookEventDedupRows: number;
  webhookOutboxEventRows: number;
  durationMs: number;
  /**
   * True when the per-tenant time budget elapsed before the batched-delete
   * loop reached a 0-row sweep. The remaining rows are picked up on the next
   * daily pass — this is informational, not an error.
   */
  truncated: boolean;
}

let stopRequested = false;
let inflight: Promise<unknown> | null = null;

async function batchedDeleteWebhookDelivery(
  client: DbClient,
  cutoff: Date,
  deadlineMs: number
): Promise<number> {
  let total = 0;
  while (Date.now() < deadlineMs) {
    const rowsAffected = await client.$executeRaw`
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

async function batchedDeleteWebhookEventDedup(
  client: DbClient,
  cutoff: Date,
  deadlineMs: number
): Promise<number> {
  let total = 0;
  while (Date.now() < deadlineMs) {
    const rowsAffected = await client.$executeRaw`
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

async function batchedDeleteWebhookOutboxEvent(
  client: DbClient,
  cutoff: Date,
  deadlineMs: number
): Promise<number> {
  let total = 0;
  while (Date.now() < deadlineMs) {
    const rowsAffected = await client.$executeRaw`
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

export async function purgeOnce(
  client: DbClient = baseDb,
  tenantId?: string,
  budgetMs: number = TENANT_PURGE_BUDGET_MS
): Promise<PurgeResult> {
  const startedAt = Date.now();
  const deadlineMs = startedAt + budgetMs;
  const cutoff = new Date(startedAt - RETENTION_MS);
  const tenantSuffix = tenantId ? ` tenant=${tenantId}` : "";

  const webhookDeliveryRows = await batchedDeleteWebhookDelivery(
    client,
    cutoff,
    deadlineMs
  );
  console.log(
    `[WebhookRetention] purged ${webhookDeliveryRows} WebhookDelivery rows (cutoff=${cutoff.toISOString()})${tenantSuffix}`
  );

  const webhookEventDedupRows = await batchedDeleteWebhookEventDedup(
    client,
    cutoff,
    deadlineMs
  );
  console.log(
    `[WebhookRetention] purged ${webhookEventDedupRows} WebhookEventDedup rows${tenantSuffix}`
  );

  const webhookOutboxEventRows = await batchedDeleteWebhookOutboxEvent(
    client,
    cutoff,
    deadlineMs
  );
  console.log(
    `[WebhookRetention] purged ${webhookOutboxEventRows} WebhookOutboxEvent rows${tenantSuffix}`
  );

  const durationMs = Date.now() - startedAt;
  const truncated = Date.now() >= deadlineMs;
  if (truncated) {
    console.warn(
      `[WebhookRetention] tenant time budget (${budgetMs}ms) elapsed${tenantSuffix}; remaining rows will be purged on the next pass`
    );
  }

  await captureAuditEvent({
    action: "WEBHOOK_RETENTION_PURGED",
    entityType: "WebhookDelivery",
    entityId: `retention-${cutoff.toISOString()}`,
    userId: SYSTEM_ACTOR_ID,
    tenantId,
    metadata: {
      retentionDays: RETENTION_DAYS,
      webhookDeliveryRows,
      webhookEventDedupRows,
      webhookOutboxEventRows,
      durationMs,
      truncated,
      cutoff: cutoff.toISOString(),
    },
  });

  return {
    webhookDeliveryRows,
    webhookEventDedupRows,
    webhookOutboxEventRows,
    durationMs,
    truncated,
  };
}

/**
 * Run one purge pass across every configured tenant in multi-tenant mode,
 * or against the singleton client in single-tenant mode.
 *
 * Memory hygiene: in multi-tenant mode, after the full pass we
 * `disconnectAllTenantClients()` so the Prisma Rust query engine releases
 * the buffers it accumulated while iterating 30+ tenant DBs. The retention
 * worker is a 24h-cadence loop, so reusing a long-lived client cache offers
 * no throughput benefit but keeps RSS climbing across passes. The dispatch
 * worker still benefits from caching per-job clients — that decision lives
 * inside `getTenantDbClient`'s callsite, not here.
 */
export async function purgeAllTenantsOnce(): Promise<PurgeResult[]> {
  if (!isMultiTenantMode()) {
    return [await purgeOnce()];
  }

  const tenantIds = getAllTenantIds();
  if (tenantIds.length === 0) {
    return [];
  }

  const results: PurgeResult[] = [];
  try {
    for (const tenantId of tenantIds) {
      try {
        const client = getTenantDbClient(tenantId);
        const result = await purgeOnce(client, tenantId);
        results.push(result);
      } catch (err) {
        console.error(
          `[WebhookRetention] Purge error for tenant ${tenantId}:`,
          err
        );
      }
    }
  } finally {
    try {
      await disconnectAllTenantClients();
    } catch (err) {
      console.error(
        "[WebhookRetention] Failed to disconnect tenant clients after pass:",
        err
      );
    }
  }
  return results;
}

export async function startLoop(): Promise<void> {
  if (isMultiTenantMode()) {
    console.log(
      `[WebhookRetention] Starting MULTI-TENANT daily retention loop (cadence=${POLL_INTERVAL_MS}ms, tenants=${getAllTenantIds().length})`
    );
  } else {
    console.log(
      `[WebhookRetention] Starting SINGLE-TENANT daily retention loop (cadence=${POLL_INTERVAL_MS}ms)`
    );
  }
  while (!stopRequested) {
    try {
      inflight = purgeAllTenantsOnce();
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
  if (isMultiTenantMode()) {
    await disconnectAllTenantClients();
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
