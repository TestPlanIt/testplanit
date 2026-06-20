/**
 * Phase 13 Wave 0 — Nyquist verification scaffold (RED until the substrate ships in 13-06).
 *
 * Per-column denylist + size guard (SAF-02 / success criterion #4).
 *   - A Steps INSERT with non-empty TipTap JSONB in `step`/`expectedResult` produces a DataChangeLog
 *     row whose `changed_cols` OMITS those denylisted columns (TipTap content is never captured).
 *   - A value larger than 32KB in an otherwise-captured column is omitted by the size guard, so the
 *     diff never carries an oversized blob.
 *
 * Gating: copies the Phase 12 spike pattern EXACTLY — skips cleanly (no DB connection) when
 * RUN_DB_INTEGRATION is unset, so the unit lane stays green.
 *
 * Run (RED today; GREEN after 13-06):
 *   RUN_DB_INTEGRATION=1 \
 *   DIRECT_DATABASE_URL="postgresql://user:password@localhost:55432/spike" \
 *   DATABASE_URL="postgresql://user:password@localhost:56432/spike" \
 *   pnpm exec vitest run --config vitest.config.mts lib/audit/__tests__/denylist.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DIRECT_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeDb = RUN_INTEGRATION && HAS_DB ? describe : describe.skip;

const ctx = (o: Record<string, string>) => JSON.stringify(o);

describeDb(
  "denylist — TipTap columns omitted + 32KB size guard (SAF-02 / success criterion #4)",
  () => {
    let direct: import("pg").Client;

    const MARKER = `denylist-${Date.now()}`;
    let seededCaseId: number;
    const createdStepIds: number[] = [];

    beforeAll(async () => {
      const { Client } = await import("pg");
      direct = new Client({ connectionString: DIRECT_URL });
      await direct.connect();

      // Drop RepositoryCases / Steps outgoing FK constraints so minimal fixture rows insert without a
      // full parent graph (the spike DB seeds none). The audit triggers fire regardless of referential
      // integrity — disposable-spike-DB pattern from Phase 12. Does NOT weaken any denylist/size-guard
      // assertion; it only lets the seed produce a real id for the trigger to capture.
      await direct.query(`DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT conrelid::regclass::text AS tbl, conname
            FROM pg_constraint
           WHERE contype = 'f'
             AND conrelid IN ('"RepositoryCases"'::regclass, '"Steps"'::regclass)
        LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname); END LOOP;
      END $$;`);

      // Parent case so the Steps FK resolves. Created with all 6 NOT-NULL FK parents.
      const r = await direct.query(
        `INSERT INTO "RepositoryCases"
         (name, "projectId", "repositoryId", "folderId", "templateId", "stateId", "creatorId")
         VALUES ($1, 1, 1, 1, 1, 1, 'denylist-creator') RETURNING id`,
        [`${MARKER}-case`]
      );
      seededCaseId = r.rows[0].id;
    }, 60_000);

    afterAll(async () => {
      if (direct) {
        try {
          if (createdStepIds.length) {
            await direct.query(`DELETE FROM "Steps" WHERE id = ANY($1)`, [
              createdStepIds,
            ]);
          }
          if (seededCaseId != null) {
            await direct.query(`DELETE FROM "RepositoryCases" WHERE id = $1`, [
              seededCaseId,
            ]);
          }
        } catch {
          /* best effort */
        }
        await direct.end();
      }
    });

    it("a Steps INSERT with TipTap step/expectedResult → changed_cols OMITS step and expectedResult (SAF-02)", async () => {
      const tiptap = JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `${MARKER}-tiptap` }],
          },
        ],
      });
      const order = Math.floor(Math.random() * 1_000_000);

      await direct.query("BEGIN");
      await direct.query("SELECT set_config('app.audit_context', $1, true)", [
        ctx({ userId: "denylist-actor" }),
      ]);
      const ins = await direct.query(
        `INSERT INTO "Steps" ("testCaseId", "order", step, "expectedResult")
         VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING id`,
        [seededCaseId, order, tiptap, tiptap]
      );
      await direct.query("COMMIT");
      createdStepIds.push(ins.rows[0].id);

      const r = await direct.query(
        `SELECT changed_cols FROM "DataChangeLog"
        WHERE "table" = 'Steps' AND op = 'I' AND pk = $1
        ORDER BY id DESC LIMIT 1`,
        [String(ins.rows[0].id)]
      );
      expect(r.rows).toHaveLength(1);
      const cols = Object.keys(r.rows[0].changed_cols);
      // SAF-02: denylisted TipTap content columns must never appear in the captured diff.
      expect(cols).not.toContain("step");
      expect(cols).not.toContain("expectedResult");
    });

    it("a >32KB value in a captured column is omitted by the size guard", async () => {
      // `className` is a normally-captured text column on RepositoryCases; a >32KB value must be
      // dropped by the size guard so the diff never carries an oversized blob. We mutate `className`
      // (oversized) ALONGSIDE a normal `name` change in the SAME UPDATE: the size guard omits the
      // oversized `className` while the row is still written for the small `name` diff. (An UPDATE
      // whose ONLY changed column is oversized legitimately short-circuits to no row via the no-op
      // guard — `diff = '{}'`; pairing with a captured column exercises the guard's real intent:
      // drop the oversized value, keep the rest of the diff.)
      const huge = "x".repeat(33 * 1024); // 33KB > 32KB threshold
      const smallName = `${MARKER}-sizeguard`;

      await direct.query("BEGIN");
      await direct.query("SELECT set_config('app.audit_context', $1, true)", [
        ctx({ userId: "denylist-actor" }),
      ]);
      await direct.query(
        `UPDATE "RepositoryCases" SET "className" = $1, name = $2 WHERE id = $3`,
        [huge, smallName, seededCaseId]
      );
      await direct.query("COMMIT");

      const r = await direct.query(
        `SELECT changed_cols FROM "DataChangeLog"
        WHERE "table" = 'RepositoryCases' AND op = 'U' AND pk = $1
        ORDER BY id DESC LIMIT 1`,
        [String(seededCaseId)]
      );
      expect(r.rows).toHaveLength(1);
      const captured = r.rows[0].changed_cols ?? {};
      // The small `name` change IS captured (proves the row was written, not short-circuited).
      expect(captured.name?.new).toBe(smallName);
      // Size guard: the oversized `className` is omitted entirely (never appears in the diff).
      expect("className" in captured).toBe(false);
      // And no captured column value may exceed 32KB once serialized.
      for (const value of Object.values(captured)) {
        expect(JSON.stringify(value).length).toBeLessThanOrEqual(32 * 1024);
      }
    });
  }
);
