import type { DbClient } from "~/lib/zenstack";

import { SYSTEM_ACTOR_ID } from "../lib/auditContextConstants";
import {
  disconnectAllTenantClients,
  getAllTenantIds,
  getTenantPrismaClient,
  isMultiTenantMode,
} from "../lib/multiTenantPrisma";
import { prisma } from "../lib/prismaBase";
import { captureAuditEvent } from "../lib/services/auditLog";

/**
 * DataChangeLog retention worker.
 *
 * Polled-loop standalone process. Wakes once per day, calls purgeAllTenantsOnce(),
 * sleeps until the next pass. Batched-deletes DataChangeLog rows where:
 *   processed = true AND ts < now() - RETENTION_DAYS
 *
 * Multi-tenant mode: DataChangeLog lives in every tenant database (the capture
 * triggers are applied per-DB), so each pass iterates getAllTenantIds() and purges
 * each tenant's database via getTenantPrismaClient(), emitting one audit row per
 * (tenant, run) — single-tenant mode purges the one prismaBase client. Mirrors
 * webhookRetentionWorker.
 *
 * Unprocessed rows (processed = false) are NEVER deleted — the append-only
 * trigger (datachangelog_append_only) enforces this at the DB level too, so
 * a future code bug that omits the filter still hits RAISE 42501 insufficient_privilege.
 *
 * The LIMIT-1000 subquery pattern avoids a single giant DELETE locking the
 * table and starving the capture path — identical idiom to webhookRetentionWorker.
 *
 * Uses the raw prismaBase client / vanilla per-tenant clients (bypasses
 * @@deny('all', true)) — the same raw-client pattern the correlation worker uses.
 */

/** Fixed 30-day retention window (ROADMAP success criterion 2 — do NOT make env-configurable). */
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Wake once per day. */
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Per-tenant time budget. A tenant with a huge first-time backlog could keep the LIMIT-1000
 * batched-delete loop running for a long time and starve every other tenant on the same worker.
 * Capping each tenant per pass makes forward progress on every tenant per cycle; whatever rows
 * remain are cleaned up on the next daily pass. Mirrors the webhook retention worker.
 */
const TENANT_PURGE_BUDGET_MS = 5 * 60 * 1000;

export interface PurgeResult {
  dataChangeLogRows: number;
  durationMs: number;
  /**
   * True when the per-tenant time budget elapsed before the batched-delete loop reached a 0-row
   * sweep. The remaining rows are picked up on the next daily pass — informational, not an error.
   */
  truncated: boolean;
}

let stopRequested = false;
let inflight: Promise<unknown> | null = null;

export async function purgeOnce(
  client: DbClient = prisma,
  tenantId?: string,
  budgetMs: number = TENANT_PURGE_BUDGET_MS
): Promise<PurgeResult> {
  const startedAt = Date.now();
  const deadlineMs = startedAt + budgetMs;
  const cutoff = new Date(startedAt - RETENTION_MS);
  const tenantSuffix = tenantId ? ` tenant=${tenantId}` : "";

  let total = 0;
  while (Date.now() < deadlineMs) {
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
  const truncated = Date.now() >= deadlineMs;

  console.log(
    `[DataChangeLogRetention] purged ${total} DataChangeLog rows (cutoff=${cutoff.toISOString()}, durationMs=${durationMs})${tenantSuffix}`
  );
  if (truncated) {
    console.warn(
      `[DataChangeLogRetention] tenant time budget (${budgetMs}ms) elapsed${tenantSuffix}; remaining rows will be purged on the next pass`
    );
  }

  await captureAuditEvent({
    action: "DCL_RETENTION_PURGED",
    entityType: "DataChangeLog",
    entityId: `retention-${cutoff.toISOString()}`,
    userId: SYSTEM_ACTOR_ID,
    tenantId,
    metadata: {
      retentionDays: RETENTION_DAYS,
      dataChangeLogRows: total,
      durationMs,
      truncated,
      cutoff: cutoff.toISOString(),
    },
  });

  return { dataChangeLogRows: total, durationMs, truncated };
}

/**
 * Run one purge pass across every configured tenant in multi-tenant mode, or against the singleton
 * prismaBase client in single-tenant mode. Per-tenant errors are isolated so one tenant's failure
 * never aborts the rest of the pass.
 *
 * Memory hygiene: in multi-tenant mode the tenant clients are disconnected after the full pass —
 * this is a 24h-cadence loop, so a long-lived per-tenant client cache offers no throughput benefit
 * but would keep RSS climbing across passes (the same rationale as webhookRetentionWorker).
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
        const client = getTenantPrismaClient(tenantId);
        results.push(await purgeOnce(client, tenantId));
      } catch (err) {
        console.error(
          `[DataChangeLogRetention] Purge error for tenant ${tenantId}:`,
          err
        );
      }
    }
  } finally {
    try {
      await disconnectAllTenantClients();
    } catch (err) {
      console.error(
        "[DataChangeLogRetention] Failed to disconnect tenant clients after pass:",
        err
      );
    }
  }
  return results;
}

export async function startLoop(): Promise<void> {
  if (isMultiTenantMode()) {
    console.log(
      `[DataChangeLogRetention] Starting MULTI-TENANT daily retention loop (cadence=${POLL_INTERVAL_MS}ms, retentionDays=${RETENTION_DAYS}, tenants=${getAllTenantIds().length})`
    );
  } else {
    console.log(
      `[DataChangeLogRetention] Starting SINGLE-TENANT daily retention loop (cadence=${POLL_INTERVAL_MS}ms, retentionDays=${RETENTION_DAYS})`
    );
  }
  while (!stopRequested) {
    try {
      inflight = purgeAllTenantsOnce();
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
  console.log("[DataChangeLogRetention] Running as standalone process...");
  startLoop().catch((err) => {
    console.error("[DataChangeLogRetention] Loop failed:", err);
    process.exit(1);
  });
}
