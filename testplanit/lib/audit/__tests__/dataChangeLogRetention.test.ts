/**
 * GREEN after the 16-04 apply gate reapplies the carve-out to the spike DB.
 *
 * Proves the DataChangeLog retention invariants on the spike DB:
 *   1. Old processed rows (ts < 30 days) are deleted by purgeOnce().
 *   2. Recent processed rows (ts < 30 days ago) survive.
 *   3. Unprocessed rows (even very old ones) survive (never deleted).
 *   4. A direct DELETE of an unprocessed row is rejected by the DB trigger
 *      with 42501 "DELETE of unprocessed rows not permitted" (DB-enforced,
 *      not just app-trust — the carve-out in datachangelog_append_only()).
 *
 * Window is keyed off `ts` (the insert timestamp), NOT processedAt — DataChangeLog
 * has no processedAt column. Unprocessed rows are excluded by processed = true,
 * so they survive regardless of their ts age.
 *
 * Gating: copies the Phase 13 spike pattern — skips cleanly when RUN_DB_INTEGRATION
 * is unset, so the unit lane stays green.
 *
 * Run (GREEN after 16-04 apply gate):
 *   RUN_DB_INTEGRATION=1 \
 *   DIRECT_DATABASE_URL="postgresql://user:password@localhost:55432/spike" \
 *   pnpm exec vitest run --config vitest.config.mts lib/audit/__tests__/dataChangeLogRetention.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DIRECT_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeDb = RUN_INTEGRATION && HAS_DB ? describe : describe.skip;

describeDb("dataChangeLogRetention — processed=true rows pruned, unprocessed rows never deleted", () => {
  let direct: import("pg").Client;

  // Unique tag scopes all assertions to rows this test run created.
  const MARKER = `dclretain-${Date.now()}`;

  // Track seeded row ids for afterAll cleanup.
  const seededIds: bigint[] = [];
  // Subset of seeded ids that are unprocessed (trigger blocks direct DELETE — mark processed first).
  const unprocessedIds: bigint[] = [];

  beforeAll(async () => {
    const { Client } = await import(/* @vite-ignore */ "pg");
    direct = new Client({ connectionString: DIRECT_URL });
    await direct.connect();
  }, 60_000);

  afterAll(async () => {
    if (direct) {
      try {
        // Mark surviving unprocessed rows processed=true first (trigger allows this UPDATE),
        // then delete them. The processed=true rows that survived the prune can be deleted directly.
        if (unprocessedIds.length > 0) {
          await direct.query(
            `UPDATE "DataChangeLog" SET processed = true WHERE id = ANY($1::bigint[])`,
            [unprocessedIds.map(String)]
          );
        }
        // Delete all remaining seeded rows (old-processed already gone after prune).
        if (seededIds.length > 0) {
          await direct.query(
            `DELETE FROM "DataChangeLog" WHERE id = ANY($1::bigint[]) AND processed = true`,
            [seededIds.map(String)]
          );
        }
      } catch {
        /* best effort — spike DB is disposable */
      }
      await direct.end();
    }
  });

  it("seeds rows and runs purgeOnce, then asserts old-processed deleted, recent-processed and unprocessed survive", async () => {
    // Seed 3 rows: processed=true, ts = now() - 40 days (should be pruned)
    const oldProcessedResult = await direct.query(
      `INSERT INTO "DataChangeLog" ("table", op, pk, changed_cols, actor, txid, ts, processed)
       SELECT
         $1, 'U', 'test-pk-' || gs, $2::jsonb,
         $3, txid_current(), now() - interval '40 days', true
       FROM generate_series(1, 3) gs
       RETURNING id`,
      [MARKER, JSON.stringify({ col: { old: "a", new: "b" } }), `${MARKER}-actor`]
    );
    const oldProcessedIds: bigint[] = oldProcessedResult.rows.map((r: { id: bigint }) => BigInt(r.id));
    seededIds.push(...oldProcessedIds);

    // Seed 2 rows: processed=true, ts = now() - 5 days (should survive)
    const recentProcessedResult = await direct.query(
      `INSERT INTO "DataChangeLog" ("table", op, pk, changed_cols, actor, txid, ts, processed)
       SELECT
         $1, 'U', 'test-pk-recent-' || gs, $2::jsonb,
         $3, txid_current(), now() - interval '5 days', true
       FROM generate_series(1, 2) gs
       RETURNING id`,
      [MARKER, JSON.stringify({ col: { old: "c", new: "d" } }), `${MARKER}-actor`]
    );
    const recentProcessedIds: bigint[] = recentProcessedResult.rows.map((r: { id: bigint }) => BigInt(r.id));
    seededIds.push(...recentProcessedIds);

    // Seed 2 rows: processed=false, ts = now() - 40 days (should NEVER be deleted)
    const unprocessedResult = await direct.query(
      `INSERT INTO "DataChangeLog" ("table", op, pk, changed_cols, actor, txid, ts, processed)
       SELECT
         $1, 'I', 'test-pk-unproc-' || gs, $2::jsonb,
         $3, txid_current(), now() - interval '40 days', false
       FROM generate_series(1, 2) gs
       RETURNING id`,
      [MARKER, JSON.stringify({ col: { old: null, new: "e" } }), `${MARKER}-actor`]
    );
    const unprocessedRowIds: bigint[] = unprocessedResult.rows.map((r: { id: bigint }) => BigInt(r.id));
    seededIds.push(...unprocessedRowIds);
    unprocessedIds.push(...unprocessedRowIds);

    // Verify we seeded the expected counts before pruning.
    const beforeCount = await direct.query(
      `SELECT count(*)::int AS n FROM "DataChangeLog" WHERE actor = $1`,
      [`${MARKER}-actor`]
    );
    expect(beforeCount.rows[0].n).toBe(7);

    // Run purgeOnce via the exported function (uses prismaBase against the spike DB).
    // Dynamic import keeps the module out of the skipped unit lane.
    const workerMod = "../../../workers/dataChangeLogRetentionWorker";
    const { purgeOnce } = await import(/* @vite-ignore */ workerMod);
    const result = await purgeOnce();

    // purgeOnce deleted at least the 3 old-processed rows we seeded.
    expect(result.dataChangeLogRows).toBeGreaterThanOrEqual(3);

    // Old processed rows (40 days) are gone.
    const oldProcessedCount = await direct.query(
      `SELECT count(*)::int AS n FROM "DataChangeLog" WHERE id = ANY($1::bigint[])`,
      [oldProcessedIds.map(String)]
    );
    expect(oldProcessedCount.rows[0].n).toBe(0);

    // Recent processed rows (5 days) survive.
    const recentCount = await direct.query(
      `SELECT count(*)::int AS n FROM "DataChangeLog" WHERE id = ANY($1::bigint[])`,
      [recentProcessedIds.map(String)]
    );
    expect(recentCount.rows[0].n).toBe(2);

    // Unprocessed rows (even 40 days old) survive.
    const unprocessedCount = await direct.query(
      `SELECT count(*)::int AS n FROM "DataChangeLog" WHERE id = ANY($1::bigint[])`,
      [unprocessedRowIds.map(String)]
    );
    expect(unprocessedCount.rows[0].n).toBe(2);
  });

  it("tamper-evidence: direct DELETE of an unprocessed row is rejected with 42501 (datachangelog_append_only carve-out)", async () => {
    // Pick one unprocessed row seeded in the previous test.
    // If unprocessedIds is empty (previous test skipped or failed), seed a fresh one.
    let targetId: bigint;
    if (unprocessedIds.length > 0) {
      targetId = unprocessedIds[0];
    } else {
      const r = await direct.query(
        `INSERT INTO "DataChangeLog" ("table", op, pk, changed_cols, actor, txid, ts, processed)
         VALUES ($1, 'I', 'tamper-pk', $2::jsonb, $3, txid_current(), now() - interval '40 days', false)
         RETURNING id`,
        [MARKER, JSON.stringify({ col: { old: null, new: "f" } }), `${MARKER}-actor`]
      );
      targetId = BigInt(r.rows[0].id);
      seededIds.push(targetId);
      unprocessedIds.push(targetId);
    }

    // Attempt a direct DELETE on the unprocessed row — must fail with 42501.
    let caughtError: unknown = null;
    try {
      await direct.query(`DELETE FROM "DataChangeLog" WHERE id = $1`, [String(targetId)]);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    const errMsg = (caughtError as { message?: string; code?: string })?.message ?? "";
    const errCode = (caughtError as { code?: string })?.code ?? "";
    expect(errCode === "42501" || errMsg.toLowerCase().includes("not permitted") || errMsg.toLowerCase().includes("append-only")).toBe(true);
  });
});
