import type { DbClient } from "~/lib/zenstack";

import { baseDb } from "../lib/db";
import {
  disconnectAllTenantClients,
  getAllTenantIds,
  getTenantDbClient,
  isMultiTenantMode,
} from "../lib/multiTenantDb";
import { emitDatasetRowReleased } from "../lib/webhooks/event-emitters/datasetLeaseEvents";

/**
 * DataSetRow lease sweep worker (999.12).
 *
 * Polled-loop standalone process. Wakes every ~60s (leases are measured in
 * minutes, not days) and reaps rows whose lease TTL has lapsed: clears the
 * four lease columns and emits a `dataset.row.released` (reason=expired)
 * webhook per reaped row.
 *
 * IMPORTANT — this sweep is for OBSERVABILITY + table hygiene only, NOT
 * correctness. The acquire query already treats `leaseExpiresAt < now()` as
 * free (lazy expiry), so acquisition works even if this worker is down. The
 * only consequence of a lagging sweep is that the `dataset.row.released`
 * (expired) event fires late and the lease columns linger until the next
 * pass. A benign race — an acquire steals an expired row before the sweep
 * reaps it — is therefore expected: the reap CTE re-checks `leaseExpiresAt <
 * now()` under a row lock, so a row re-leased with a fresh (future) TTL is
 * simply skipped and never emits a false release.
 *
 * Multi-tenant mode: iterates getAllTenantIds() once per cadence and sweeps
 * each tenant's database via getTenantDbClient(). Mirrors
 * webhookRetentionWorker.
 */

/** Wake every 60s. */
const POLL_INTERVAL_MS = 60 * 1000;
/** Rows reaped per statement — keeps each transaction small. */
const SWEEP_BATCH_SIZE = 500;
/**
 * Per-tenant time budget. With many tenants on one worker, cap the batched
 * loop so no single tenant with a large backlog starves the others; the rest
 * are reaped on the next 60s pass.
 */
const TENANT_SWEEP_BUDGET_MS = 30 * 1000;

/** One expired row, as returned by the reap CTE (pre-clear values). */
interface ReapedRow {
  id: number;
  dataSetId: number;
  rowIndex: number;
  label: string | null;
  leasedById: string | null;
  leaseExpiresAt: Date | null;
  projectId: number;
}

export interface SweepResult {
  /** Rows whose lease was reaped this pass. */
  reaped: number;
  /** Number of batch transactions executed. */
  batches: number;
  /** True when the per-tenant time budget elapsed before the pool drained. */
  truncated: boolean;
}

let stopRequested = false;
let inflight: Promise<unknown> | null = null;

/**
 * Reap one batch of expired leases inside a single transaction: lock up to
 * SWEEP_BATCH_SIZE expired rows (`FOR UPDATE OF r SKIP LOCKED` so a
 * concurrent acquire mid-claim is skipped rather than blocked), clear their
 * lease columns, and return the PRE-clear identifiers so we can emit one
 * `dataset.row.released` (expired) per row inside the same tx (atomic with
 * the clear). Returns the reaped rows.
 */
async function reapBatch(client: DbClient): Promise<ReapedRow[]> {
  return client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ReapedRow[]>`
      WITH expired AS (
        SELECT r."id", r."dataSetId", r."rowIndex", r."label",
               r."leasedById", r."leaseExpiresAt", d."projectId"
          FROM "DataSetRow" r
          JOIN "DataSet" d ON d."id" = r."dataSetId"
         WHERE r."leaseToken" IS NOT NULL
           AND r."leaseExpiresAt" < now()
         ORDER BY r."leaseExpiresAt" ASC
         LIMIT ${SWEEP_BATCH_SIZE}
         FOR UPDATE OF r SKIP LOCKED
      ), cleared AS (
        UPDATE "DataSetRow" SET
          "leasedById" = NULL, "leasedAt" = NULL,
          "leaseExpiresAt" = NULL, "leaseToken" = NULL
        WHERE "id" IN (SELECT "id" FROM expired)
        RETURNING "id"
      )
      SELECT e."id", e."dataSetId", e."rowIndex", e."label",
             e."leasedById", e."leaseExpiresAt", e."projectId"
        FROM expired e
    `;

    for (const row of rows) {
      await emitDatasetRowReleased(
        {
          dataSetId: row.dataSetId,
          rowId: row.id,
          rowIndex: row.rowIndex,
          label: row.label,
          projectId: row.projectId,
          leasedById: row.leasedById,
          leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
        },
        "expired",
        tx,
        // The lease's original holder is the actor; a system reap has no
        // authenticated user, so attribute to the prior holder for the trail.
        { actorUserId: row.leasedById }
      );
    }
    return rows;
  });
}

/**
 * Run one sweep pass against a single database: loop reapBatch() until a
 * batch comes back empty or the time budget elapses.
 */
export async function sweepOnce(
  client: DbClient = baseDb,
  tenantId?: string,
  budgetMs: number = TENANT_SWEEP_BUDGET_MS
): Promise<SweepResult> {
  const startedAt = Date.now();
  const deadlineMs = startedAt + budgetMs;
  const tenantSuffix = tenantId ? ` tenant=${tenantId}` : "";
  let reaped = 0;
  let batches = 0;

  while (Date.now() < deadlineMs) {
    const rows = await reapBatch(client);
    batches += 1;
    reaped += rows.length;
    if (rows.length < SWEEP_BATCH_SIZE) break;
  }

  const truncated = Date.now() >= deadlineMs;
  if (reaped > 0 || truncated) {
    console.log(
      `[DatasetLeaseSweep] reaped ${reaped} expired lease(s) in ${batches} batch(es)${tenantSuffix}${
        truncated ? " (budget elapsed; remainder next pass)" : ""
      }`
    );
  }
  return { reaped, batches, truncated };
}

/**
 * Run one sweep pass across every configured tenant (multi-tenant) or the
 * singleton client (single-tenant). Mirrors webhookRetentionWorker's
 * disconnect-after-pass memory hygiene.
 */
export async function sweepAllTenantsOnce(): Promise<SweepResult[]> {
  if (!isMultiTenantMode()) {
    return [await sweepOnce()];
  }

  const tenantIds = getAllTenantIds();
  if (tenantIds.length === 0) return [];

  const results: SweepResult[] = [];
  try {
    for (const tenantId of tenantIds) {
      try {
        const client = getTenantDbClient(tenantId) as unknown as DbClient;
        results.push(await sweepOnce(client, tenantId));
      } catch (err) {
        console.error(
          `[DatasetLeaseSweep] Sweep error for tenant ${tenantId}:`,
          err
        );
      }
    }
  } finally {
    try {
      await disconnectAllTenantClients();
    } catch (err) {
      console.error(
        "[DatasetLeaseSweep] Failed to disconnect tenant clients after pass:",
        err
      );
    }
  }
  return results;
}

export async function startLoop(): Promise<void> {
  console.log(
    `[DatasetLeaseSweep] Starting ${
      isMultiTenantMode() ? "MULTI-TENANT" : "SINGLE-TENANT"
    } lease sweep loop (cadence=${POLL_INTERVAL_MS}ms)`
  );
  while (!stopRequested) {
    try {
      inflight = sweepAllTenantsOnce();
      await inflight;
    } catch (err) {
      console.error("[DatasetLeaseSweep] Sweep error:", err);
    } finally {
      inflight = null;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.log("[DatasetLeaseSweep] Sweep loop exited");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[DatasetLeaseSweep] Received ${signal}, shutting down...`);
  stopRequested = true;
  if (inflight) {
    try {
      await inflight;
    } catch {
      // Ignore — startLoop catches sweep errors.
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
  console.log("[DatasetLeaseSweep] Running as standalone process...");
  startLoop().catch((err) => {
    console.error("[DatasetLeaseSweep] Loop failed:", err);
    process.exit(1);
  });
}
