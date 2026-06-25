/**
 * Live-DB integration test for materializeIterations.
 *
 * Per feedback_prisma_helper_live_db_test: Phase 2 shipped a runtime bug
 * (helper wrote `parameters` to RepositoryCaseVersions before the column
 * existed) that 6 plans + 6127 unit tests missed because every integration
 * test mocked `tx` as `any`. This test exercises a REAL baseDb.$transaction
 * so unknown-column errors surface immediately.
 *
 * Execution model:
 *   - Skipped by default. Opt-in with `RUN_DB_INTEGRATION=1`.
 *   - Requires DATABASE_URL pointing at a development/test database.
 *   - Every test runs in its own baseDb.$transaction and ROLLS BACK at the
 *     end so the DB is left untouched. This means tests are non-destructive
 *     and re-runnable against any environment.
 *   - Cleanup: the rollback throws an internal sentinel error that the
 *     test catches and discards. Vitest's test isolation is therefore
 *     transactional, not via DELETE statements.
 *
 * What this catches that a mocked test cannot:
 *   - Column-not-found errors (the original Phase 1 bug class)
 *   - Schema/Prisma client mismatches after a missed `pnpm generate`
 *   - Foreign-key constraint violations from misordered inserts
 *   - JSON column shape mismatches (e.g., string vs object)
 *   - The `rowIndex` (NOT iterationOrder) field name invariant — at the
 *     wire level, not just the type level
 */

import { afterAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("materializeIterations (live DB)", () => {
  // Lazy-import to keep this module pure when skipped — avoids spinning up
  // Prisma in unit-test contexts where the DB is unreachable.
  const importDeps = async () => {
    const { baseDb } = await import("~/lib/db");
    const { materializeIterations, materializeForOneCase } =
      await import("./iterationFanOut");
    return { baseDb, materializeIterations, materializeForOneCase };
  };

  // Sentinel rolled-back transactions throw this so we can identify them.
  const ROLLBACK_SENTINEL = "__ITERATION_FAN_OUT_TEST_ROLLBACK__";

  /**
   * Run `body` inside a transaction and ALWAYS roll back. Returns whatever
   * `body` returned — but the DB state is reverted before returning.
   */
  async function withRollback<T>(
    baseDb: any,
    body: (tx: any) => Promise<T>,
    timeoutMs = 60_000
  ): Promise<T> {
    let captured: T | undefined;
    let captureErr: unknown;
    try {
      await baseDb.$transaction(
        async (tx: any) => {
          try {
            captured = await body(tx);
          } catch (err) {
            captureErr = err;
          }
          // Force rollback — Prisma rolls back on any thrown error.
          throw new Error(ROLLBACK_SENTINEL);
        },
        { timeout: timeoutMs }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes(ROLLBACK_SENTINEL)) {
        throw err;
      }
    }
    if (captureErr) throw captureErr;
    return captured as T;
  }

  /**
   * Inserts a tiny fixture graph and returns the IDs needed for the test.
   * Caller must run this inside `withRollback` so all rows disappear.
   */
  async function seedFixture(tx: any) {
    // Need a creator user (FK requirement on Projects.createdBy and many
    // descendant rows). Use any existing user — seed.ts always creates
    // at least an admin.
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) {
      throw new Error(
        "No User row available — seed the DB before running this integration test"
      );
    }
    // Need a state for RepositoryCases.stateId / TestRuns.stateId.
    const state = await tx.workflows.findFirst({ select: { id: true } });
    if (!state) {
      throw new Error(
        "No Workflows row available — seed the DB with a default workflow before running this integration test"
      );
    }
    // Need a template for RepositoryCases.templateId.
    const template = await tx.templates.findFirst({ select: { id: true } });
    if (!template) {
      throw new Error(
        "No Templates row available — seed the DB before running this integration test"
      );
    }

    // Project / repository / folder — minimal viable graph.
    const project = await tx.projects.create({
      data: {
        name: `iter-fanout-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdBy: creator.id,
      },
      select: { id: true },
    });
    const repo = await tx.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    const folder = await tx.repositoryFolders.create({
      data: {
        name: `f-${Date.now()}`,
        repositoryId: repo.id,
        projectId: project.id,
        creatorId: creator.id,
      },
      select: { id: true },
    });

    const testCase = await tx.repositoryCases.create({
      data: {
        projectId: project.id,
        repositoryId: repo.id,
        folderId: folder.id,
        templateId: template.id,
        name: `Param Case ${Date.now()}`,
        stateId: state.id,
        creatorId: creator.id,
        hasParameters: true,
      },
      select: { id: true },
    });

    // Two parameters — one sensitive, one not.
    await tx.testCaseParameter.createMany({
      data: [
        {
          testCaseId: testCase.id,
          name: "username",
          type: "STRING",
          sensitive: false,
          required: true,
          order: 0,
        },
        {
          testCaseId: testCase.id,
          name: "password",
          type: "STRING",
          sensitive: true,
          required: true,
          order: 1,
        },
      ],
    });

    // Dataset with three rows.
    const dataset = await tx.dataSet.create({
      data: {
        name: `ds-${Date.now()}`,
        ownerCaseId: testCase.id,
        projectId: project.id,
        createdById: creator.id,
      },
      select: { id: true },
    });
    await tx.dataSetRow.createMany({
      data: [
        {
          dataSetId: dataset.id,
          rowIndex: 0,
          label: "alice",
          valuesJson: { username: "alice", password: "p1" },
        },
        {
          dataSetId: dataset.id,
          rowIndex: 1,
          label: "bob",
          valuesJson: { username: "bob", password: "p2" },
        },
        {
          dataSetId: dataset.id,
          rowIndex: 2,
          label: "carol",
          valuesJson: { username: "carol", password: "p3" },
        },
      ],
    });

    // Test run + run case.
    const stateForRun = await tx.workflows.findFirst({ select: { id: true } });
    const testRun = await tx.testRuns.create({
      data: {
        name: `run-${Date.now()}`,
        projectId: project.id,
        stateId: stateForRun.id,
        createdById: creator.id,
        testRunType: "REGULAR",
      },
      select: { id: true },
    });
    const testRunCase = await tx.testRunCases.create({
      data: {
        testRunId: testRun.id,
        repositoryCaseId: testCase.id,
        order: 0,
      },
      select: { id: true },
    });

    return {
      projectId: project.id,
      repositoryCaseId: testCase.id,
      datasetId: dataset.id,
      testRunId: testRun.id,
      testRunCaseId: testRunCase.id,
    };
  }

  afterAll(async () => {
    // Explicit disconnect so the test process exits cleanly.
    if (RUN_INTEGRATION && HAS_DB_URL) {
      const { baseDb } = await import("~/lib/db");
      await baseDb.$disconnect();
    }
  });

  it("materializes one iteration row per dataset row with rowIndex (not iterationOrder)", async () => {
    const { baseDb, materializeIterations } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);
      const result = await materializeIterations(fx.testRunId, tx);

      expect(result.iterationCount).toBe(3);
      expect(result.parameterizedRunCaseCount).toBe(1);

      // Verify N rows landed with the correct field name.
      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
        orderBy: { rowIndex: "asc" },
        select: { rowIndex: true, label: true, valuesJson: true },
      });
      expect(iterations).toHaveLength(3);
      expect(iterations.map((i: any) => i.rowIndex)).toEqual([0, 1, 2]);
      expect(iterations.map((i: any) => i.label)).toEqual([
        "alice",
        "bob",
        "carol",
      ]);
    });
  });

  it("snapshot row preserves dataset rows (rowsJson) and parameter schema (parametersJson)", async () => {
    const { baseDb, materializeIterations } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
        where: { testRunCaseId: fx.testRunCaseId },
      });
      expect(snapshot).not.toBeNull();

      const params = snapshot.parametersJson as Array<{
        name: string;
        sensitive: boolean;
      }>;
      expect(params.map((p) => p.name).sort()).toEqual([
        "password",
        "username",
      ]);
      expect(params.find((p) => p.name === "password")?.sensitive).toBe(true);
      expect(params.find((p) => p.name === "username")?.sensitive).toBe(false);

      const rows = snapshot.rowsJson as Array<{
        valuesJson: any;
        rowIndex: number;
      }>;
      expect(rows).toHaveLength(3);
      expect(rows[0].valuesJson).toEqual({ username: "alice", password: "p1" });
    });
  });

  it("snapshot is immutable: editing source dataset after snapshot does NOT change snapshot rows", async () => {
    const { baseDb, materializeIterations } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      // Mutate the source dataset — flip alice → ALICE, soft-delete bob.
      const aliceRow = await tx.dataSetRow.findFirst({
        where: { dataSetId: fx.datasetId, rowIndex: 0 },
      });
      await tx.dataSetRow.update({
        where: { id: aliceRow.id },
        data: { valuesJson: { username: "ALICE", password: "MUTATED" } },
      });
      const bobRow = await tx.dataSetRow.findFirst({
        where: { dataSetId: fx.datasetId, rowIndex: 1 },
      });
      await tx.dataSetRow.update({
        where: { id: bobRow.id },
        data: { isDeleted: true },
      });

      // Re-read the snapshot — it must still have the original alice/bob/carol.
      const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
        where: { testRunCaseId: fx.testRunCaseId },
      });
      const rows = snapshot.rowsJson as Array<{ valuesJson: any }>;
      expect(rows[0].valuesJson).toEqual({ username: "alice", password: "p1" });
      expect(rows[1].valuesJson).toEqual({ username: "bob", password: "p2" });
      expect(rows.length).toBe(3);

      // Iteration valuesJson must also be unchanged.
      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
        orderBy: { rowIndex: "asc" },
      });
      expect(iterations[0].valuesJson).toEqual({
        username: "alice",
        password: "p1",
      });
    });
  });

  it("each iteration's valuesJson matches the corresponding snapshot row by rowIndex", async () => {
    const { baseDb, materializeIterations } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
        where: { testRunCaseId: fx.testRunCaseId },
      });
      const snapRows = snapshot.rowsJson as Array<{
        valuesJson: any;
        rowIndex: number;
      }>;

      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
        orderBy: { rowIndex: "asc" },
      });

      iterations.forEach((it: any, idx: number) => {
        expect(it.valuesJson).toEqual(snapRows[idx].valuesJson);
      });
    });
  });

  it("updates TestRunCases.totalIterations to the row count", async () => {
    const { baseDb, materializeIterations } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const runCase = await tx.testRunCases.findUnique({
        where: { id: fx.testRunCaseId },
        select: {
          totalIterations: true,
          passedIterations: true,
          failedIterations: true,
          skippedIterations: true,
        },
      });
      expect(runCase.totalIterations).toBe(3);
      expect(runCase.passedIterations).toBe(0);
      expect(runCase.failedIterations).toBe(0);
      expect(runCase.skippedIterations).toBe(0);
    });
  });

  it("links every iteration to the snapshot via dataSetSnapshotId FK", async () => {
    const { baseDb, materializeIterations } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);
      await materializeIterations(fx.testRunId, tx);

      const snapshot = await tx.testRunCaseDataSetSnapshot.findUnique({
        where: { testRunCaseId: fx.testRunCaseId },
      });
      const iterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: fx.testRunCaseId },
      });
      iterations.forEach((it: any) => {
        expect(it.dataSetSnapshotId).toBe(snapshot.id);
      });
    });
  });

  it("non-parameterized cases are skipped (no snapshot, no iterations, totalIterations stays 0)", async () => {
    const { baseDb, materializeIterations } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);
      // Flip the case to non-parameterized.
      await tx.repositoryCases.update({
        where: { id: fx.repositoryCaseId },
        data: { hasParameters: false },
      });

      const result = await materializeIterations(fx.testRunId, tx);
      expect(result.iterationCount).toBe(0);
      expect(result.parameterizedRunCaseCount).toBe(0);

      const snapCount = await tx.testRunCaseDataSetSnapshot.count({
        where: { testRunCaseId: fx.testRunCaseId },
      });
      expect(snapCount).toBe(0);

      const runCase = await tx.testRunCases.findUnique({
        where: { id: fx.testRunCaseId },
      });
      expect(runCase.totalIterations).toBe(0);
    });
  });

  it("rolls back atomically when an error is thrown after fan-out completes (ITER-06 atomicity)", async () => {
    // ITER-06 invariant (VALIDATION.md): fan-out is all-or-nothing. If
    // anything throws after materializeIterations runs but before the
    // transaction commits, the snapshot + iteration rows must NOT persist.
    //
    // We exercise this by running the full materialize inside a real
    // baseDb.$transaction that throws a sentinel error at the end. Prisma
    // rolls back; we then read OUTSIDE any transaction to confirm that no
    // TestRunCaseIteration rows survive. Since the seed data is also part
    // of the rolled-back transaction, this leaves the DB untouched.
    const { baseDb, materializeIterations } = await importDeps();
    const ROLLBACK_TAG = `__ITER06_ATOMIC_${Date.now()}__`;
    let snapshotIdFromInsideTx: number | undefined;
    let testRunCaseIdFromInsideTx: number | undefined;

    let thrown: unknown;
    try {
      await baseDb.$transaction(async (tx: any) => {
        const fx = await seedFixture(tx);
        testRunCaseIdFromInsideTx = fx.testRunCaseId;
        const result = await materializeIterations(fx.testRunId, tx);
        // Sanity: materializeIterations actually wrote rows inside the tx
        // (the rollback then reverts those writes).
        expect(result.iterationCount).toBeGreaterThan(0);
        const snap = await tx.testRunCaseDataSetSnapshot.findFirst({
          where: { testRunCaseId: fx.testRunCaseId },
          select: { id: true },
        });
        snapshotIdFromInsideTx = snap?.id;
        expect(snapshotIdFromInsideTx).toBeDefined();
        throw new Error(ROLLBACK_TAG);
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(ROLLBACK_TAG);

    // Read OUTSIDE the tx — none of the in-tx writes should survive.
    const surviveSnapshot = snapshotIdFromInsideTx
      ? await baseDb.testRunCaseDataSetSnapshot.findUnique({
          where: { id: snapshotIdFromInsideTx },
          select: { id: true },
        })
      : null;
    expect(surviveSnapshot).toBeNull();

    const surviveIterations = testRunCaseIdFromInsideTx
      ? await baseDb.testRunCaseIteration.count({
          where: { testRunCaseId: testRunCaseIdFromInsideTx },
        })
      : 0;
    expect(surviveIterations).toBe(0);
  });

  it("emits progress callbacks at the configured cadence", async () => {
    const { baseDb, materializeIterations } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);
      const events: Array<{
        processedCases: number;
        totalCases: number;
        iterationsSoFar: number;
      }> = [];
      await materializeIterations(fx.testRunId, tx, {
        progressIntervalCases: 1, // emit on every case
        onProgress: async (info) => {
          events.push(info);
        },
      });
      // One parameterized case → exactly one progress event.
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        processedCases: 1,
        totalCases: 1,
        iterationsSoFar: 3,
      });
    });
  });
});
