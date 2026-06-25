/**
 * Phase 14 Wave 0 — Nyquist verification scaffold (RED until the CDC consumer ships in 14-05).
 *
 * Pins COR-01 + CTX-03 end-to-end against the live substrate. The correlation worker
 * (lib/audit/correlation — does NOT exist yet) polls unprocessed DataChangeLog rows, materializes
 * them into AuditLog, threads operationId, and marks processed=true idempotently. Behaviors:
 *   COR-01 (poll + materialize + flag) — a batch of unprocessed DataChangeLog rows is polled,
 *           written into AuditLog, and the source rows are marked processed=true.
 *   CTX-03 (operationId threading)     — three DataChangeLog rows sharing one operation_id produce
 *           AuditLog rows all stamped with that operationId.
 *   idempotency                        — a second poll over the same already-processed seq range
 *           inserts ZERO new AuditLog rows (ON CONFLICT DO NOTHING on the partial idempotency index).
 *   crash-resume                       — re-running the poll after AuditLog rows were written but
 *           BEFORE processed was marked produces ZERO duplicate AuditLog rows.
 *
 * Gating: copies the captureMatrix.test.ts pattern EXACTLY — RUN_INTEGRATION / HAS_DB / describeDb.
 * Skips cleanly (no DB connection attempted) when RUN_DB_INTEGRATION is unset, so the unit lane stays
 * green. DataChangeLog / AuditLog reads go through a direct `pg.Client` (no policy layer). The
 * not-yet-existing worker module is imported via a runtime-built specifier + /* @vite-ignore *​/ so
 * Vite's static import-analysis can't resolve the missing module at transform time.
 *
 * Implementing plan: 14-05 (workers/auditLogWorker.ts Loop B + lib/audit/correlation).
 *
 * Run (RED today; GREEN after 14-05 + the 14-02 idempotency index):
 *   RUN_DB_INTEGRATION=1 \
 *   DIRECT_DATABASE_URL="postgresql://user:password@localhost:55432/spike" \
 *   DATABASE_URL="postgresql://user:password@localhost:55432/spike" \
 *   pnpm exec vitest run --config vitest.config.mts lib/audit/__tests__/correlationWorker.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DIRECT_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeDb = RUN_INTEGRATION && HAS_DB ? describe : describe.skip;

describeDb(
  "correlationWorker (COR-01 + CTX-03) — DataChangeLog → AuditLog materialization",
  () => {
    let direct: import("pg").Client;

    // The not-yet-existing CDC consumer. Runtime-built specifier + /* @vite-ignore */ so the skipped
    // unit lane never tries to resolve the missing module. 14-05 ships:
    //   pollDataChangeLogsOnce(rawDb) — one poll pass: SELECT ... WHERE processed=false
    //     FOR UPDATE SKIP LOCKED, group by operationId, rollup, humanize, INSERT AuditLog
    //     ON CONFLICT DO NOTHING, then UPDATE DataChangeLog SET processed=true.
    //     markProcessed=false skips the final flag UPDATE (used by the crash-resume case).
    let pollDataChangeLogsOnce: (
      rawDb: unknown,
      opts?: { batchSize?: number; markProcessed?: boolean }
    ) => Promise<{ processed: number; auditLogsWritten: number }>;
    let rawDb: any;

    // Unique marker scopes every assertion to rows this run created.
    const MARKER = `corrworker-${Date.now()}`;
    const OP_ID = `op-${MARKER}`;

    // Direct DataChangeLog seeding so the worker has unprocessed rows to consume. Each row models a
    // captured change on a root entity (RepositoryCases) so the rollup map attributes to itself.
    const seedDcl = async (
      op: string,
      pk: string,
      operationId: string | null,
      name: string
    ) => {
      await direct.query(
        `INSERT INTO "DataChangeLog" ("table", op, pk, changed_cols, actor, operation_id, txid, processed)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, txid_current(), false)`,
        [
          "RepositoryCases",
          op,
          pk,
          JSON.stringify({ name: { old: null, new: name } }),
          "actor-corr",
          operationId,
        ]
      );
    };

    // Generic DataChangeLog seed: any audited table + an arbitrary changed_cols diff. Models a single
    // captured mutation that the worker will roll up (CaseFieldValues/Steps → RepositoryCases) and
    // humanize (fieldId → CaseFields.displayName). DataChangeLog stores the diff as opaque JSON, so no
    // FK validation occurs on the seed — the worker's rollup/humanize read the JSON, not live FKs.
    const seedDclRow = async (
      table: string,
      op: string,
      pk: string,
      operationId: string | null,
      changedCols: Record<string, { old: unknown; new: unknown }>
    ) => {
      await direct.query(
        `INSERT INTO "DataChangeLog" ("table", op, pk, changed_cols, actor, operation_id, txid, processed)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, txid_current(), false)`,
        [table, op, pk, JSON.stringify(changedCols), "actor-corr", operationId]
      );
    };

    const countAuditLogsForOp = async (
      operationId: string
    ): Promise<number> => {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM "AuditLog" WHERE "operationId" = $1`,
        [operationId]
      );
      return r.rows[0].n as number;
    };

    const auditRowsForOp = async (operationId: string) => {
      const r = await direct.query(
        `SELECT "entityType", "entityId", "action", "changes", "sourceTable", "operationId"
         FROM "AuditLog" WHERE "operationId" = $1 ORDER BY "sourceTable", "entityId"`,
        [operationId]
      );
      return r.rows as Array<{
        entityType: string;
        entityId: string;
        action: string;
        changes: Record<
          string,
          { old?: unknown; new?: unknown; oldName?: unknown; newName?: unknown }
        >;
        sourceTable: string;
        operationId: string;
      }>;
    };

    // A real CaseFields catalog row so the worker's live humanize lookup resolves fieldId → its
    // displayName (criterion 3). Seeded with the FK-drop disposable-spike pattern.
    let seededFieldId: number;
    let seededFieldName: string;

    beforeAll(async () => {
      const { Client } = await import("pg");
      direct = new Client({ connectionString: DIRECT_URL });
      await direct.connect();

      const prismaMod = "~/lib/rawDb";
      const correlationMod = "~/lib/audit/correlation";
      ({ rawDb: rawDb } = await import(/* @vite-ignore */ prismaMod));
      ({ pollDataChangeLogsOnce } = await import(
        /* @vite-ignore */ correlationMod
      ));

      // Drop CaseFields outgoing FKs so a minimal catalog row inserts on the bare spike DB, then seed
      // one CaseFields row whose displayName is what the worker must surface instead of the raw id.
      await direct.query(`DO $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT conname FROM pg_constraint
                  WHERE contype = 'f' AND conrelid = '"CaseFields"'::regclass
        LOOP EXECUTE format('ALTER TABLE "CaseFields" DROP CONSTRAINT IF EXISTS %I', r.conname); END LOOP;
      END $$;`);
      seededFieldName = `Priority-${MARKER}`;
      const ins = await direct.query(
        `INSERT INTO "CaseFields" ("displayName", "systemName", "typeId") VALUES ($1, $2, $3) RETURNING id`,
        [seededFieldName, `sys-${MARKER}`, 1]
      );
      seededFieldId = ins.rows[0].id as number;
    }, 60_000);

    afterAll(async () => {
      if (direct) {
        try {
          await direct.query(
            `DELETE FROM "AuditLog" WHERE "operationId" = $1`,
            [OP_ID]
          );
          await direct.query(
            `DELETE FROM "AuditLog" WHERE "operationId" = $1`,
            [`${OP_ID}-rollup`]
          );
          if (seededFieldId != null) {
            await direct.query(`DELETE FROM "CaseFields" WHERE id = $1`, [
              seededFieldId,
            ]);
          }
          // DataChangeLog is append-only (DELETE blocked by the Phase 13 enforcement trigger); the
          // disposable spike DB keeps the consumed source rows. Best-effort only.
          await direct.query(
            `DELETE FROM "DataChangeLog" WHERE operation_id = $1`,
            [OP_ID]
          );
        } catch {
          /* best effort — append-only DataChangeLog DELETE is expected to be refused */
        }
        await direct.end();
      }
    });

    it("COR-01 + CTX-03: polls unprocessed rows, materializes AuditLog stamped with the shared operationId, marks processed=true", async () => {
      // Three rows sharing ONE operation_id model a single logical save (RepositoryCases + 2 children
      // rolled up to the same owner). They must all carry OP_ID in AuditLog.
      await seedDcl("U", "9001", OP_ID, `${MARKER}-1`);
      await seedDcl("U", "9001", OP_ID, `${MARKER}-2`);
      await seedDcl("U", "9001", OP_ID, `${MARKER}-3`);

      const result = await pollDataChangeLogsOnce(rawDb, {
        batchSize: 500,
      });
      expect(result.processed).toBeGreaterThanOrEqual(3);

      // CTX-03: every materialized AuditLog row for this save carries the shared operationId — and
      // ALL of them share it (the GROUPED outcome, not merely that one row materialized).
      const rows = await auditRowsForOp(OP_ID);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.every((r) => r.operationId === OP_ID)).toBe(true);

      // COR-01: the source DataChangeLog rows are now marked processed=true.
      const unprocessed = await direct.query(
        `SELECT count(*)::int AS n FROM "DataChangeLog" WHERE operation_id = $1 AND processed = false`,
        [OP_ID]
      );
      expect(unprocessed.rows[0].n).toBe(0);
    });

    it("HEADLINE UAT (criteria 1+2+3): a 3-request case save sharing ONE operationId → one grouped operationId, children rolled up to the parent RepositoryCases, and field ids humanized to names", async () => {
      // The headline: a single logical case save fans out into three captured mutations under ONE
      // X-Operation-Id — the root RepositoryCases edit plus two child rows (a CaseFieldValues change
      // and a Steps change). All three share ROLLUP_OP.
      const ROLLUP_OP = `${OP_ID}-rollup`;
      const CASE_PK = "8500"; // the owning RepositoryCases id

      // (request 1) the root case itself — roots to itself
      await seedDclRow("RepositoryCases", "U", CASE_PK, ROLLUP_OP, {
        title: { old: "Old title", new: `${MARKER}-case` },
      });
      // (request 2) a CaseFieldValues child carrying its parent FK (testCaseId) AND a fieldId change
      // that must be humanized to the seeded CaseFields.displayName.
      await seedDclRow("CaseFieldValues", "U", "70001", ROLLUP_OP, {
        testCaseId: { old: null, new: Number(CASE_PK) },
        fieldId: { old: null, new: seededFieldId },
      });
      // (request 3) a Steps child carrying its parent FK (testCaseId).
      await seedDclRow("Steps", "U", "70002", ROLLUP_OP, {
        testCaseId: { old: null, new: Number(CASE_PK) },
        description: { old: "before", new: "after" },
      });

      await pollDataChangeLogsOnce(rawDb, { batchSize: 500 });

      const rows = await auditRowsForOp(ROLLUP_OP);
      // Criterion 1 — GROUPED: all materialized rows for this save carry the one shared operationId.
      expect(rows.length).toBe(3);
      expect(new Set(rows.map((r) => r.operationId))).toEqual(
        new Set([ROLLUP_OP])
      );

      // Criterion 2 — ROLLUP: the CaseFieldValues + Steps child rows are attributed to the PARENT
      // RepositoryCases (entityType=RepositoryCases, entityId=the case pk), NOT left as orphan
      // child-table entries. The root row also attributes to the same case.
      expect(rows.every((r) => r.entityType === "RepositoryCases")).toBe(true);
      expect(rows.every((r) => r.entityId === CASE_PK)).toBe(true);
      // The two children genuinely came from the child tables (sourceTable proves the rollup, not a
      // coincidental same-entity edit).
      expect(new Set(rows.map((r) => r.sourceTable))).toEqual(
        new Set(["RepositoryCases", "CaseFieldValues", "Steps"])
      );

      // Criterion 3 — HUMANIZATION: the CaseFieldValues row's fieldId diff is annotated with the
      // resolved display NAME (seededFieldName), not just the raw id.
      const cfv = rows.find((r) => r.sourceTable === "CaseFieldValues");
      expect(cfv).toBeDefined();
      expect(cfv!.changes.fieldId).toMatchObject({
        new: seededFieldId,
        newName: seededFieldName,
      });
    });

    it("idempotency: a second poll over the already-processed range inserts ZERO new AuditLog rows", async () => {
      const before = await countAuditLogsForOp(OP_ID);
      // Nothing unprocessed remains for OP_ID, so a re-poll is a no-op for this operation.
      await pollDataChangeLogsOnce(rawDb, { batchSize: 500 });
      expect(await countAuditLogsForOp(OP_ID)).toBe(before);
    });

    it("crash-resume: a batch transaction that aborts mid-flush rolls back both the inserts AND the cursor, and a clean re-poll yields exactly ONE set of AuditLog rows (no duplicates)", async () => {
      // The worker writes the AuditLog INSERTs AND the processed=true cursor UPDATE in ONE
      // $transaction (correlation.ts invariant #3). A REAL mid-batch crash therefore aborts the whole
      // transaction — NEITHER the inserts NOR the cursor commit — so the source rows stay
      // processed=false and a clean re-poll reprocesses them with zero duplicates. This is the
      // primary crash-safety guarantee and covers ALL rows, INCLUDING null-operationId singletons
      // (the partial idempotency index only covers non-null operationId). The first pass below uses
      // BOTH a shared-operationId row AND a null-operationId row to exercise that broader guarantee.
      const RESUME_OP = `${OP_ID}-resume`;

      // A $transaction wrapper that runs the worker's real batch (SELECT → INSERT AuditLog → mark
      // processed) and then throws BEFORE the transaction commits, forcing Prisma to roll back the
      // entire batch — exactly a worker that died mid-flush. Everything else delegates to rawDb.
      class SimulatedCrash extends Error {}
      const crashOnce = new Proxy(rawDb, {
        get(target, prop, receiver) {
          if (prop === "$transaction") {
            return (fn: (tx: unknown) => Promise<unknown>) =>
              target.$transaction(async (tx: unknown) => {
                await fn(tx); // real inserts + cursor UPDATE happen here, uncommitted
                throw new SimulatedCrash(
                  "simulated mid-batch crash before commit"
                );
              });
          }
          return Reflect.get(target, prop, receiver);
        },
      });

      await seedDcl("U", "9002", RESUME_OP, `${MARKER}-resume-op`);
      await seedDcl("U", "9003", null, `${MARKER}-resume-null`); // null-operationId singleton path

      const nullOpCount = async (): Promise<number> => {
        const r = await direct.query(
          `SELECT count(*)::int AS n FROM "AuditLog"
           WHERE "operationId" IS NULL AND metadata->>'cdc' = 'true'
             AND changes->'name'->>'new' = $1`,
          [`${MARKER}-resume-null`]
        );
        return r.rows[0].n as number;
      };

      // First pass crashes mid-transaction → rollback → NOTHING committed.
      await expect(
        pollDataChangeLogsOnce(crashOnce as never, { batchSize: 500 })
      ).rejects.toBeInstanceOf(SimulatedCrash);
      expect(await countAuditLogsForOp(RESUME_OP)).toBe(0); // rolled back
      expect(await nullOpCount()).toBe(0); // null-op row rolled back too

      // Rows are still processed=false (cursor rolled back), so a clean re-poll reprocesses them.
      await pollDataChangeLogsOnce(rawDb, { batchSize: 500 });
      const afterResume = await countAuditLogsForOp(RESUME_OP);
      expect(afterResume).toBeGreaterThanOrEqual(1);
      expect(await nullOpCount()).toBe(1); // exactly one null-op AuditLog row — no duplicate

      // A SECOND clean re-poll must add nothing more — the ON CONFLICT idempotency index (non-null
      // operationId) plus the now-advanced cursor guarantee no duplicate rows on either path.
      await pollDataChangeLogsOnce(rawDb, { batchSize: 500 });
      expect(await countAuditLogsForOp(RESUME_OP)).toBe(afterResume);
      expect(await nullOpCount()).toBe(1);

      // Cleanup: AuditLog is deletable; DataChangeLog is append-only (DELETE blocked by the Phase 13
      // enforcement trigger), so leave the consumed source rows in place on the disposable spike DB.
      await direct.query(`DELETE FROM "AuditLog" WHERE "operationId" = $1`, [
        RESUME_OP,
      ]);
      await direct.query(
        `DELETE FROM "AuditLog" WHERE "operationId" IS NULL AND metadata->>'cdc' = 'true'
         AND changes->'name'->>'new' = $1`,
        [`${MARKER}-resume-null`]
      );
    });

    it("defense-in-depth: even if AuditLog commits WITHOUT the cursor advancing, the ON CONFLICT idempotency index makes the re-poll add ZERO duplicate rows", async () => {
      // The belt-and-suspenders path (correlation.ts invariant #3): a hypothetical anomaly where the
      // AuditLog INSERT committed but processed=true did NOT. markProcessed=false reproduces exactly
      // that committed-insert / un-advanced-cursor state, so the re-poll re-selects the same rows and
      // the partial unique index (operationId, sourceTable, entityId, action) DO NOTHING absorbs them.
      const IDEM_OP = `${OP_ID}-idem`;
      try {
        await seedDcl("U", "9004", IDEM_OP, `${MARKER}-idem-1`);
        await seedDcl("U", "9004", IDEM_OP, `${MARKER}-idem-2`);

        await pollDataChangeLogsOnce(rawDb, {
          batchSize: 500,
          markProcessed: false,
        });
        const afterFirst = await countAuditLogsForOp(IDEM_OP);
        expect(afterFirst).toBeGreaterThanOrEqual(1);

        // Rows are still processed=false → re-selected; the idempotency index blocks every duplicate.
        await pollDataChangeLogsOnce(rawDb, { batchSize: 500 });
        expect(await countAuditLogsForOp(IDEM_OP)).toBe(afterFirst);
      } finally {
        await direct.query(`DELETE FROM "AuditLog" WHERE "operationId" = $1`, [
          IDEM_OP,
        ]);
      }
    });

    it("actor attribution (REC-04 'who changed this'): a captured actor becomes AuditLog.userId; a row with NO actor is recorded as the __system__ sentinel", async () => {
      const ACTOR_OP = `op-actor-${MARKER}`;
      // Row 1: a user-session mutation carrying a real actor (the GUC was set).
      await direct.query(
        `INSERT INTO "DataChangeLog" ("table", op, pk, changed_cols, actor, operation_id, txid, processed)
       VALUES ('RepositoryCases','I','9001', $1::jsonb, $2, $3, txid_current(), false)`,
        [
          JSON.stringify({ name: { old: null, new: "human-made" } }),
          "human-actor-xyz",
          ACTOR_OP,
        ]
      );
      // Row 2: a system path (worker/seed/migration) with NO actor — must become __system__.
      await direct.query(
        `INSERT INTO "DataChangeLog" ("table", op, pk, changed_cols, actor, operation_id, txid, processed)
       VALUES ('RepositoryCases','I','9002', $1::jsonb, NULL, $2, txid_current(), false)`,
        [JSON.stringify({ name: { old: null, new: "system-made" } }), ACTOR_OP]
      );
      try {
        await pollDataChangeLogsOnce(rawDb, { batchSize: 500 });
        const r = await direct.query(
          `SELECT "entityId", "userId" FROM "AuditLog" WHERE "operationId" = $1 ORDER BY "entityId"`,
          [ACTOR_OP]
        );
        const byEntity = Object.fromEntries(
          r.rows.map((x: { entityId: string; userId: string }) => [
            x.entityId,
            x.userId,
          ])
        );
        expect(byEntity["9001"]).toBe("human-actor-xyz");
        expect(byEntity["9002"]).toBe("__system__");
      } finally {
        await direct.query(`DELETE FROM "AuditLog" WHERE "operationId" = $1`, [
          ACTOR_OP,
        ]);
      }
    });
  }
);
