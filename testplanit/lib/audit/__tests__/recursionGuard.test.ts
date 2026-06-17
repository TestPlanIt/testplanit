/**
 * Phase 13 Wave 0 — Nyquist verification scaffold (RED until the substrate ships in 13-06).
 *
 * Recursion guard (SAF-03) + append-only enforcement (success criterion #5).
 *   (i)  A mutation produces EXACTLY ONE DataChangeLog row, not N — proving the pg_trigger_depth()>1
 *        guard and the absence of a GENERIC audit trigger on DataChangeLog itself (SAF-03).
 *   (ii) Append-only — all THREE behaviors of the 13-03 enforcement triggers:
 *        (1) UPDATE "DataChangeLog" SET actor=... RAISES a privilege error (SQLSTATE 42501).
 *        (2) DELETE FROM "DataChangeLog"     RAISES a privilege error (SQLSTATE 42501).
 *        (3) a worker-cursor-only UPDATE (SET processed=true) SUCCEEDS — the worker path stays open.
 *   Success criterion #5 is met by the RAISE (a DB-level privilege error from the enforcement
 *   trigger), NOT by a REVOKE.
 *
 * Gating: copies the Phase 12 spike pattern EXACTLY — skips cleanly (no DB connection) when
 * RUN_DB_INTEGRATION is unset, so the unit lane stays green.
 *
 * Run (RED today; GREEN after 13-06):
 *   RUN_DB_INTEGRATION=1 \
 *   DIRECT_DATABASE_URL="postgresql://user:password@localhost:55432/spike" \
 *   DATABASE_URL="postgresql://user:password@localhost:56432/spike" \
 *   pnpm exec vitest run --config vitest.config.mts lib/audit/__tests__/recursionGuard.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DIRECT_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeDb = RUN_INTEGRATION && HAS_DB ? describe : describe.skip;

const ctx = (o: Record<string, string>) => JSON.stringify(o);

// Postgres SQLSTATE for insufficient_privilege — what the enforcement triggers RAISE.
const PRIVILEGE_ERROR = "42501";

describeDb("recursionGuard — no cascade (SAF-03) + append-only enforcement (success criterion #5)", () => {
  let direct: import("pg").Client;

  const MARKER = `recguard-${Date.now()}`;
  let seededCaseId: number;
  // A DataChangeLog row id we inserted directly, used as the target for the append-only assertions.
  let fixtureLogId: string;

  beforeAll(async () => {
    const { Client } = await import("pg");
    direct = new Client({ connectionString: DIRECT_URL });
    await direct.connect();

    // Drop RepositoryCases outgoing FK constraints so a minimal fixture row inserts without a full
    // parent graph (the spike DB seeds none). The audit triggers fire regardless of referential
    // integrity — disposable-spike-DB pattern from Phase 12. Does NOT weaken any recursion/append-only
    // assertion; it only lets the seed produce a real id for the recursion-guard mutation.
    await direct.query(`DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT conname FROM pg_constraint
           WHERE contype = 'f' AND conrelid = '"RepositoryCases"'::regclass
        LOOP EXECUTE format('ALTER TABLE "RepositoryCases" DROP CONSTRAINT IF EXISTS %I', r.conname); END LOOP;
      END $$;`);

    // Parent case for the recursion test (all 6 NOT-NULL FK parents).
    const r = await direct.query(
      `INSERT INTO "RepositoryCases"
         (name, "projectId", "repositoryId", "folderId", "templateId", "stateId", "creatorId")
         VALUES ($1, 1, 1, 1, 1, 1, 'recguard-creator') RETURNING id`,
      [`${MARKER}-case`],
    );
    seededCaseId = r.rows[0].id;

    // Insert a DataChangeLog fixture row directly (the direct pg.Client can INSERT — only the
    // enforcement triggers block UPDATE/DELETE). This gives us a target id for the append-only
    // assertions below.
    const log = await direct.query(
      `INSERT INTO "DataChangeLog" ("table", op, pk, changed_cols, txid, ts)
         VALUES ('RepositoryCases', 'I', $1, '{}'::jsonb, txid_current(), now())
         RETURNING id`,
      [`${MARKER}-fixture`],
    );
    fixtureLogId = String(log.rows[0].id);
  }, 60_000);

  afterAll(async () => {
    if (direct) {
      try {
        if (seededCaseId != null) {
          await direct.query(`DELETE FROM "RepositoryCases" WHERE id = $1`, [seededCaseId]);
        }
      } catch {
        /* best effort — DataChangeLog rows are append-only and intentionally not deleted */
      }
      await direct.end();
    }
  });

  it("(i) a single mutation produces EXACTLY ONE DataChangeLog row, not N (SAF-03 recursion guard)", async () => {
    await direct.query("BEGIN");
    await direct.query("SELECT set_config('app.audit_context', $1, true)", [ctx({ userId: "recguard-actor" })]);
    await direct.query(`UPDATE "RepositoryCases" SET name = $1 WHERE id = $2`, [`${MARKER}-updated`, seededCaseId]);
    await direct.query("COMMIT");

    const r = await direct.query(
      `SELECT count(*)::int AS n FROM "DataChangeLog"
        WHERE "table" = 'RepositoryCases' AND op = 'U' AND changed_cols->'name'->>'new' = $1`,
      [`${MARKER}-updated`],
    );
    // Exactly one row: pg_trigger_depth()>1 guard + no generic trigger on DataChangeLog → no cascade.
    expect(r.rows[0].n).toBe(1);
  });

  it("(ii.1) UPDATE \"DataChangeLog\" SET actor=... RAISES a privilege error (42501) — append-only", async () => {
    await expect(
      direct.query(`UPDATE "DataChangeLog" SET actor = 'tamper' WHERE id = $1`, [fixtureLogId]),
    ).rejects.toMatchObject({ code: PRIVILEGE_ERROR });
  });

  it("(ii.2) DELETE FROM \"DataChangeLog\" RAISES a privilege error (42501) — append-only", async () => {
    await expect(
      direct.query(`DELETE FROM "DataChangeLog" WHERE id = $1`, [fixtureLogId]),
    ).rejects.toMatchObject({ code: PRIVILEGE_ERROR });
  });

  it("(ii.3) worker-cursor UPDATE \"DataChangeLog\" SET processed=true SUCCEEDS — worker path stays open", async () => {
    // The worker cursor must remain able to flip the processed flag; the enforcement trigger allows
    // an UPDATE that touches ONLY processed/processedAt.
    await expect(
      direct.query(`UPDATE "DataChangeLog" SET processed = true WHERE id = $1`, [fixtureLogId]),
    ).resolves.toBeDefined();

    const r = await direct.query(`SELECT processed FROM "DataChangeLog" WHERE id = $1`, [fixtureLogId]);
    expect(r.rows[0].processed).toBe(true);
  });
});
