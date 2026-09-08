/**
 * Live-DB integration test for `runMatrixAggregation`.
 *
 * The matrix aggregation is the highest-risk seam in the Matrix view:
 *   - Raw SQL with multi-key GROUP BY across 4 joined tables.
 *   - Cross-project denial relies on a WHERE-clause bound, not policy.
 *   - Sensitive parameter redaction MUST happen server-side or values
 *     leak to UIs / CSV exports.
 *   - Worst-of rollup parity with the existing `computeWorstOfStatus`
 *     helper — drift here corrupts every cell.
 *   - `mostRecentCompletedAt` MUST emerge from `MAX(iter.completedAt)`,
 *     not from insertion order.
 *
 * Mirrors the iterationFanOut.shared.integration.test.ts pattern:
 *   - Skipped by default; opt-in with `RUN_DB_INTEGRATION=1`.
 *   - Each test runs inside a `baseDb.$transaction` rolled back at end.
 *   - Lazy import Prisma so the module stays cheap when skipped.
 */

import { afterAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("runMatrixAggregation (live DB)", () => {
  const importDeps = async () => {
    const { baseDb } = await import("~/lib/db");
    const { runMatrixAggregation, MatrixCellCapExceededError } =
      await import("./matrixAggregation");
    const { computeWorstOfStatus } =
      await import("~/lib/services/iterationRollup");
    const { materializeForOneCase } =
      await import("~/lib/services/iterationFanOut");
    const { cellKey } = await import("./types");
    return {
      baseDb,
      runMatrixAggregation,
      MatrixCellCapExceededError,
      computeWorstOfStatus,
      materializeForOneCase,
      cellKey,
    };
  };

  const ROLLBACK_SENTINEL = "__MATRIX_TEST_ROLLBACK__";

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
          throw new Error(ROLLBACK_SENTINEL);
        },
        { timeout: timeoutMs }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes(ROLLBACK_SENTINEL)) throw err;
    }
    if (captureErr) throw captureErr;
    return captured as T;
  }

  /**
   * Seed a project with the prerequisite scaffolding (user, workflow,
   * template, configurations) and return the ids the per-test logic
   * needs.
   */
  async function seedProjectScaffold(
    tx: any,
    namePrefix: string
  ): Promise<{
    creatorId: string;
    projectId: number;
    repositoryId: number;
    folderId: number;
    workflowId: number;
    templateId: number;
    chromeConfigId: number;
    firefoxConfigId: number;
    passedStatusId: number;
    failedStatusId: number;
    untestedStatusId: number;
  }> {
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("Seed the DB first (no User row)");
    const state = await tx.workflows.findFirst({ select: { id: true } });
    if (!state) throw new Error("Seed the DB first (no Workflows row)");
    const template = await tx.templates.findFirst({ select: { id: true } });
    if (!template) throw new Error("Seed the DB first (no Templates row)");
    const passed = await tx.status.findFirst({
      where: { systemName: "passed" },
      select: { id: true },
    });
    const failed = await tx.status.findFirst({
      where: { systemName: "failed" },
      select: { id: true },
    });
    const untested = await tx.status.findFirst({
      where: { systemName: "untested" },
      select: { id: true },
    });
    if (!passed || !failed || !untested) {
      throw new Error(
        "Seed the DB first (missing passed/failed/untested status)"
      );
    }

    const project = await tx.projects.create({
      data: {
        name: `${namePrefix}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
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
    const chrome = await tx.configurations.create({
      data: {
        name: `Chrome-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      },
      select: { id: true },
    });
    const firefox = await tx.configurations.create({
      data: {
        name: `Firefox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      },
      select: { id: true },
    });

    return {
      creatorId: creator.id,
      projectId: project.id,
      repositoryId: repo.id,
      folderId: folder.id,
      workflowId: state.id,
      templateId: template.id,
      chromeConfigId: chrome.id,
      firefoxConfigId: firefox.id,
      passedStatusId: passed.id,
      failedStatusId: failed.id,
      untestedStatusId: untested.id,
    };
  }

  async function createParamCase(
    tx: any,
    scaffold: Awaited<ReturnType<typeof seedProjectScaffold>>,
    name: string,
    params: Array<{ name: string; sensitive?: boolean }>
  ): Promise<number> {
    const c = await tx.repositoryCases.create({
      data: {
        projectId: scaffold.projectId,
        repositoryId: scaffold.repositoryId,
        folderId: scaffold.folderId,
        templateId: scaffold.templateId,
        name,
        stateId: scaffold.workflowId,
        creatorId: scaffold.creatorId,
        hasParameters: true,
      },
      select: { id: true },
    });
    if (params.length > 0) {
      await tx.testCaseParameter.createMany({
        data: params.map((p, i) => ({
          testCaseId: c.id,
          name: p.name,
          type: "STRING",
          sensitive: p.sensitive ?? false,
          required: false,
          order: i,
        })),
      });
    }
    return c.id;
  }

  async function createNonParamCase(
    tx: any,
    scaffold: Awaited<ReturnType<typeof seedProjectScaffold>>,
    name: string
  ): Promise<number> {
    const c = await tx.repositoryCases.create({
      data: {
        projectId: scaffold.projectId,
        repositoryId: scaffold.repositoryId,
        folderId: scaffold.folderId,
        templateId: scaffold.templateId,
        name,
        stateId: scaffold.workflowId,
        creatorId: scaffold.creatorId,
        hasParameters: false,
      },
      select: { id: true },
    });
    return c.id;
  }

  async function attachOwnerDataset(
    tx: any,
    scaffold: Awaited<ReturnType<typeof seedProjectScaffold>>,
    repositoryCaseId: number,
    rows: Array<{ label: string; values: Record<string, unknown> }>
  ): Promise<number> {
    const ds = await tx.dataSet.create({
      data: {
        name: `ds-${repositoryCaseId}-${Date.now()}`,
        ownerCaseId: repositoryCaseId,
        projectId: scaffold.projectId,
        createdById: scaffold.creatorId,
      },
      select: { id: true },
    });
    if (rows.length > 0) {
      await tx.dataSetRow.createMany({
        data: rows.map((r, i) => ({
          dataSetId: ds.id,
          rowIndex: i,
          label: r.label,
          valuesJson: r.values,
        })),
      });
    }
    return ds.id;
  }

  async function createRunWithCase(
    tx: any,
    scaffold: Awaited<ReturnType<typeof seedProjectScaffold>>,
    repositoryCaseId: number,
    configId: number | null,
    runName?: string
  ): Promise<{ testRunId: number; testRunCaseId: number }> {
    const testRun = await tx.testRuns.create({
      data: {
        name:
          runName ??
          `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        projectId: scaffold.projectId,
        stateId: scaffold.workflowId,
        createdById: scaffold.creatorId,
        testRunType: "REGULAR",
        configId,
      },
      select: { id: true },
    });
    const trc = await tx.testRunCases.create({
      data: {
        testRunId: testRun.id,
        repositoryCaseId,
        order: 0,
      },
      select: { id: true },
    });
    return { testRunId: testRun.id, testRunCaseId: trc.id };
  }

  /**
   * Mark a run-case's iterations with explicit (statusId, completedAt)
   * tuples in `rowIndex` order. Use null entries to leave an iteration
   * in-flight.
   */
  async function setIterationStatuses(
    tx: any,
    testRunCaseId: number,
    statuses: Array<{
      statusId: number | null;
      completedAt?: Date | null;
    } | null>
  ): Promise<void> {
    const iterations = await tx.testRunCaseIteration.findMany({
      where: { testRunCaseId },
      orderBy: { rowIndex: "asc" },
    });
    for (let i = 0; i < statuses.length; i++) {
      const target = statuses[i];
      const iter = iterations[i];
      if (!target || !iter) continue;
      await tx.testRunCaseIteration.update({
        where: { id: iter.id },
        data: {
          statusId: target.statusId,
          completedAt: target.completedAt ?? null,
          isCompleted: target.statusId != null,
        },
      });
    }
  }

  afterAll(async () => {
    if (RUN_INTEGRATION && HAS_DB_URL) {
      const { baseDb } = await import("~/lib/db");
      await baseDb.$disconnect();
    }
  });

  // -------------------------------------------------------------------
  // Happy path: 2 parameterized cases (3 rows + 5 rows) x 2 configs.
  // A non-parameterized case is also seeded but should NOT appear in
  // the case axis (the matrix is parameterized-only).
  // -------------------------------------------------------------------
  it("happy path: 3-axis aggregation produces (3 + 5) x 2 = 16 cells; non-parameterized case is filtered out", async () => {
    const { baseDb, runMatrixAggregation, materializeForOneCase, cellKey } =
      await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-happy");

      const caseA = await createParamCase(tx, sc, "A", [{ name: "email" }]);
      const caseB = await createParamCase(tx, sc, "B", [{ name: "name" }]);
      const caseC = await createNonParamCase(tx, sc, "C");

      await attachOwnerDataset(tx, sc, caseA, [
        { label: "a1", values: { email: "a1@x.com" } },
        { label: "a2", values: { email: "a2@x.com" } },
        { label: "a3", values: { email: "a3@x.com" } },
      ]);
      await attachOwnerDataset(tx, sc, caseB, [
        { label: "b1", values: { name: "n1" } },
        { label: "b2", values: { name: "n2" } },
        { label: "b3", values: { name: "n3" } },
        { label: "b4", values: { name: "n4" } },
        { label: "b5", values: { name: "n5" } },
      ]);

      // Materialize caseA + caseB into both Chrome and Firefox runs.
      // Non-parameterized caseC gets a TestRunCase row in each run but
      // never produces iterations and is filtered out of the case axis.
      for (const cfg of [sc.chromeConfigId, sc.firefoxConfigId]) {
        for (const cId of [caseA, caseB]) {
          const r = await createRunWithCase(tx, sc, cId, cfg);
          await materializeForOneCase(sc.projectId, r.testRunCaseId, cId, tx);
        }
        await createRunWithCase(tx, sc, caseC, cfg);
      }

      const axes = await runMatrixAggregation(tx, sc.projectId, {}, true);

      expect(axes.cellCount).toBe(16);
      expect(axes.caseAxis).toHaveLength(2);
      expect(axes.caseAxis.find((c) => c.caseId === caseC)).toBeUndefined();
      expect(axes.configAxis).toHaveLength(2);

      // Spot-check: caseA × Chrome × row 0 has exactly one iteration,
      // currently in-flight (no status) so notRun=1.
      const a0 = axes.cells.get(cellKey(caseA, sc.chromeConfigId, 0));
      expect(a0).toBeDefined();
      expect(a0?.iterationCount).toBe(1);
      expect(a0?.notRun).toBe(1);
      expect(a0?.pass).toBe(0);
      expect(a0?.fail).toBe(0);
      expect(a0?.iterations).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------
  // Non-parameterized cases are excluded — the matrix is the
  // "Parameterized Test Iteration Matrix" and only includes cases with
  // hasParameters=true. Non-parameterized cases are handled by a
  // separate report (case × configuration only).
  // -------------------------------------------------------------------
  it("non-parameterized case is excluded from the case axis", async () => {
    const { baseDb, runMatrixAggregation } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-param07");
      const caseC = await createNonParamCase(tx, sc, "C");
      await createRunWithCase(tx, sc, caseC, sc.chromeConfigId);

      const axes = await runMatrixAggregation(tx, sc.projectId, {}, true);
      const c = axes.caseAxis.find((c) => c.caseId === caseC);
      expect(c).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // Cell-cap refusal at the 50001-cell boundary.
  // -------------------------------------------------------------------
  it("cell-cap refusal: throws MatrixCellCapExceededError above 50,000 cells", async () => {
    const { baseDb, runMatrixAggregation, MatrixCellCapExceededError } =
      await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-cap");
      // One parameterized case with 50,001 dataset rows × 1 config = 50,001 cells.
      const caseA = await createParamCase(tx, sc, "Big", [{ name: "n" }]);
      const rows = Array.from({ length: 50001 }, (_, i) => ({
        label: `r${i}`,
        values: { n: `v${i}` },
      }));
      await attachOwnerDataset(tx, sc, caseA, rows);
      const r = await createRunWithCase(tx, sc, caseA, sc.chromeConfigId);
      await (
        await import("~/lib/services/iterationFanOut")
      ).materializeForOneCase(sc.projectId, r.testRunCaseId, caseA, tx);

      let thrown: unknown = null;
      try {
        await runMatrixAggregation(tx, sc.projectId, {}, true);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(MatrixCellCapExceededError);
      const err = thrown as InstanceType<typeof MatrixCellCapExceededError>;
      expect(err.result.willRefuse).toBe(true);
      expect(err.result.cellCount).toBeGreaterThanOrEqual(50001);
      expect(err.result.threshold).toBe(50000);
    });
  });

  // -------------------------------------------------------------------
  // Sensitive parameter redaction: viewerCanReadSensitive=false hides
  // values; =true exposes them.
  // -------------------------------------------------------------------
  it("sensitive parameter redaction: hidden when viewerCanReadSensitive=false", async () => {
    const { baseDb, runMatrixAggregation } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-redact");
      const caseA = await createParamCase(tx, sc, "Login", [
        { name: "username" },
        { name: "password", sensitive: true },
      ]);
      await attachOwnerDataset(tx, sc, caseA, [
        {
          label: "creds",
          values: { username: "alice", password: "secret123" },
        },
      ]);
      const r = await createRunWithCase(tx, sc, caseA, sc.chromeConfigId);
      await (
        await import("~/lib/services/iterationFanOut")
      ).materializeForOneCase(sc.projectId, r.testRunCaseId, caseA, tx);

      const redacted = await runMatrixAggregation(tx, sc.projectId, {}, false);
      const caseAxisRedacted = redacted.caseAxis.find(
        (c) => c.caseId === caseA
      );
      expect(caseAxisRedacted?.paramRows[0].values.username).toBe("alice");
      expect(caseAxisRedacted?.paramRows[0].values.password).toBe("[REDACTED]");

      const exposed = await runMatrixAggregation(tx, sc.projectId, {}, true);
      const caseAxisExposed = exposed.caseAxis.find((c) => c.caseId === caseA);
      expect(caseAxisExposed?.paramRows[0].values.username).toBe("alice");
      expect(caseAxisExposed?.paramRows[0].values.password).toBe("secret123");
    });
  });

  // -------------------------------------------------------------------
  // Cross-project denial (helper layer): WHERE projectId scopes correctly.
  // -------------------------------------------------------------------
  it("cross-project denial (helper): WHERE projectId bound excludes other projects", async () => {
    const { baseDb, runMatrixAggregation } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const a = await seedProjectScaffold(tx, "matrix-cross-a");
      const b = await seedProjectScaffold(tx, "matrix-cross-b");

      // Parameterized cases — non-parameterized cases are filtered out
      // of the matrix axis, so the cross-project assertion needs cases
      // that actually surface in `caseAxis`.
      const caseA = await createParamCase(tx, a, "A-case", [{ name: "x" }]);
      const caseB = await createParamCase(tx, b, "B-case", [{ name: "x" }]);
      await attachOwnerDataset(tx, a, caseA, [
        { label: "a1", values: { x: "1" } },
      ]);
      await attachOwnerDataset(tx, b, caseB, [
        { label: "b1", values: { x: "1" } },
      ]);
      await createRunWithCase(tx, a, caseA, a.chromeConfigId);
      await createRunWithCase(tx, b, caseB, b.chromeConfigId);

      const axesA = await runMatrixAggregation(tx, a.projectId, {}, true);
      const axesB = await runMatrixAggregation(tx, b.projectId, {}, true);

      expect(axesA.caseAxis.map((c) => c.caseId)).toEqual([caseA]);
      expect(axesB.caseAxis.map((c) => c.caseId)).toEqual([caseB]);
      expect(
        axesA.configAxis.map((c) => c.configId).includes(b.chromeConfigId)
      ).toBe(false);
      expect(
        axesB.configAxis.map((c) => c.configId).includes(a.chromeConfigId)
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // In-flight runs: iterations with statusId=null contribute to notRun.
  // -------------------------------------------------------------------
  it("in-flight runs contribute to iterationCount and notRun", async () => {
    const { baseDb, runMatrixAggregation, materializeForOneCase, cellKey } =
      await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-inflight");
      const caseA = await createParamCase(tx, sc, "A", [{ name: "n" }]);
      await attachOwnerDataset(
        tx,
        sc,
        caseA,
        Array.from({ length: 10 }, (_, i) => ({
          label: `r${i}`,
          values: { n: `v${i}` },
        }))
      );
      const r = await createRunWithCase(tx, sc, caseA, sc.chromeConfigId);
      await materializeForOneCase(sc.projectId, r.testRunCaseId, caseA, tx);

      // Mark first 5 passed, leave last 5 in-flight (statusId stays null).
      await setIterationStatuses(tx, r.testRunCaseId, [
        { statusId: sc.passedStatusId, completedAt: new Date() },
        { statusId: sc.passedStatusId, completedAt: new Date() },
        { statusId: sc.passedStatusId, completedAt: new Date() },
        { statusId: sc.passedStatusId, completedAt: new Date() },
        { statusId: sc.passedStatusId, completedAt: new Date() },
        // remaining iterations stay null (in-flight)
      ]);

      const axes = await runMatrixAggregation(tx, sc.projectId, {}, true);
      // Each cell has exactly one iteration (one row per cell). Aggregate
      // across rows: pass should be 5, notRun 5.
      let totalPass = 0;
      let totalNotRun = 0;
      for (let i = 0; i < 10; i++) {
        const c = axes.cells.get(cellKey(caseA, sc.chromeConfigId, i));
        if (!c) continue;
        totalPass += c.pass;
        totalNotRun += c.notRun;
      }
      expect(totalPass).toBe(5);
      expect(totalNotRun).toBe(5);
    });
  });

  // -------------------------------------------------------------------
  // Worst-of rollup parity: matrix worstOfStatusId matches direct
  // computeWorstOfStatus call.
  // -------------------------------------------------------------------
  it("worst-of rollup parity with computeWorstOfStatus", async () => {
    const {
      baseDb,
      runMatrixAggregation,
      materializeForOneCase,
      computeWorstOfStatus,
      cellKey,
    } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-rollup");
      const caseA = await createParamCase(tx, sc, "A", [{ name: "n" }]);
      // 3 rows so the cell has 3 iterations.
      await attachOwnerDataset(tx, sc, caseA, [
        { label: "r0", values: { n: "0" } },
        { label: "r1", values: { n: "1" } },
        { label: "r2", values: { n: "2" } },
      ]);
      const r = await createRunWithCase(tx, sc, caseA, sc.chromeConfigId);
      await materializeForOneCase(sc.projectId, r.testRunCaseId, caseA, tx);
      // Pass / Fail / null — fail must dominate per rollup rule 2.
      await setIterationStatuses(tx, r.testRunCaseId, [
        { statusId: sc.passedStatusId, completedAt: new Date() },
        { statusId: sc.failedStatusId, completedAt: new Date() },
        null, // leave last in-flight
      ]);

      const axes = await runMatrixAggregation(tx, sc.projectId, {}, true);

      // Build the rollup status map ourselves and call the helper directly.
      const statuses = await tx.status.findMany({
        where: { isDeleted: false },
        select: {
          id: true,
          systemName: true,
          isSuccess: true,
          isFailure: true,
          isCompleted: true,
          order: true,
        },
      });
      const rollupMap = new Map<
        number,
        {
          id: number;
          systemName: string | null;
          isSuccess: boolean;
          isFailure: boolean;
          isCompleted: boolean;
          order: number;
        }
      >();
      for (const s of statuses) rollupMap.set(s.id, s as any);

      // Aggregate worst-of across all 3 rows for the cell. Each row has
      // exactly one iteration; matrix builds per-row cells.
      const expectedPerRow = [
        sc.passedStatusId, // row 0 single pass
        sc.failedStatusId, // row 1 single fail
        // row 2 in-flight only -> rollup falls back to first untested
      ];
      const r0 = axes.cells.get(cellKey(caseA, sc.chromeConfigId, 0));
      const r1 = axes.cells.get(cellKey(caseA, sc.chromeConfigId, 1));
      const r2 = axes.cells.get(cellKey(caseA, sc.chromeConfigId, 2));
      expect(r0?.worstOfStatusId).toBe(expectedPerRow[0]);
      expect(r1?.worstOfStatusId).toBe(expectedPerRow[1]);

      // Sanity: r2's worst-of equals the helper's untested fallback.
      const expectedR2 = computeWorstOfStatus(
        [{ statusId: null }],
        rollupMap as any
      );
      expect(r2?.worstOfStatusId).toBe(expectedR2);
    });
  });

  // -------------------------------------------------------------------
  // Date-range filter on TestRuns.createdAt (NOT iter.completedAt).
  // -------------------------------------------------------------------
  it("date-range filter bounds tr.createdAt, not iter.completedAt", async () => {
    const { baseDb, runMatrixAggregation, materializeForOneCase, cellKey } =
      await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-daterange");
      const caseA = await createParamCase(tx, sc, "A", [{ name: "n" }]);
      await attachOwnerDataset(tx, sc, caseA, [
        { label: "r0", values: { n: "0" } },
      ]);

      // March run — older.
      const marchRun = await tx.testRuns.create({
        data: {
          name: `march-${Date.now()}`,
          projectId: sc.projectId,
          stateId: sc.workflowId,
          createdById: sc.creatorId,
          testRunType: "REGULAR",
          configId: sc.chromeConfigId,
          createdAt: new Date("2026-03-15T10:00:00Z"),
        },
        select: { id: true },
      });
      const marchTrc = await tx.testRunCases.create({
        data: { testRunId: marchRun.id, repositoryCaseId: caseA, order: 0 },
        select: { id: true },
      });
      await materializeForOneCase(sc.projectId, marchTrc.id, caseA, tx);

      // May run — newer.
      const mayRun = await tx.testRuns.create({
        data: {
          name: `may-${Date.now()}`,
          projectId: sc.projectId,
          stateId: sc.workflowId,
          createdById: sc.creatorId,
          testRunType: "REGULAR",
          configId: sc.chromeConfigId,
          createdAt: new Date("2026-05-01T10:00:00Z"),
        },
        select: { id: true },
      });
      const mayTrc = await tx.testRunCases.create({
        data: { testRunId: mayRun.id, repositoryCaseId: caseA, order: 0 },
        select: { id: true },
      });
      await materializeForOneCase(sc.projectId, mayTrc.id, caseA, tx);

      // Filter to dateFrom = April 1: only the May run survives.
      const axes = await runMatrixAggregation(
        tx,
        sc.projectId,
        { dateFrom: "2026-04-01T00:00:00.000Z" },
        true
      );
      const cell = axes.cells.get(cellKey(caseA, sc.chromeConfigId, 0));
      expect(cell).toBeDefined();
      expect(cell?.iterationCount).toBe(1); // only May run's single iteration
      expect(cell?.iterations[0].runId).toBe(mayRun.id);
    });
  });

  // -------------------------------------------------------------------
  // Configuration sentinel: configId IS NULL collapses to id 0 / "(none)".
  // -------------------------------------------------------------------
  it("configuration sentinel: NULL configId surfaces as id=0, name=(none)", async () => {
    const { baseDb, runMatrixAggregation } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-sentinel");
      // Parameterized case so the case axis isn't filtered out — the
      // sentinel collapse is a config-axis behavior independent of the
      // case being parameterized, but we need at least one parameterized
      // case to drive `fetchConfigAxis` through the same scope filter.
      const caseA = await createParamCase(tx, sc, "A", [{ name: "x" }]);
      await attachOwnerDataset(tx, sc, caseA, [
        { label: "a1", values: { x: "1" } },
      ]);
      await createRunWithCase(tx, sc, caseA, sc.chromeConfigId);
      await createRunWithCase(tx, sc, caseA, null); // no configuration

      const axes = await runMatrixAggregation(tx, sc.projectId, {}, true);
      const ids = axes.configAxis.map((c) => c.configId).sort((a, b) => a - b);
      expect(ids).toContain(0);
      expect(ids).toContain(sc.chromeConfigId);
      const sentinel = axes.configAxis.find((c) => c.configId === 0);
      expect(sentinel?.configName).toBe("(none)");
    });
  });

  // -------------------------------------------------------------------
  // Snapshot join via TestRunCase.id (Pitfall 4): a parameterized case
  // with no dataset snapshot row does not crash; it just contributes
  // zero cells (empty paramRows).
  // -------------------------------------------------------------------
  it("parameterized case with no snapshot row: aggregation succeeds with empty paramRows", async () => {
    const { baseDb, runMatrixAggregation } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-snapshot-join");
      // Parameterized case with NO dataset attached → no snapshot row.
      const caseP = await createParamCase(tx, sc, "Bare", [{ name: "x" }]);
      await createRunWithCase(tx, sc, caseP, sc.chromeConfigId);

      const axes = await runMatrixAggregation(tx, sc.projectId, {}, true);
      const c = axes.caseAxis.find((c) => c.caseId === caseP);
      expect(c).toBeDefined();
      expect(c?.paramRows).toEqual([]);
      expect(axes.cellCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // mostRecentCompletedAt: SQL MAX across multiple iterations in the
  // SAME cell (caseId, configId, rowIndex). To force >1 iteration into
  // one cell, we seed two SEPARATE TestRunCases under different runs —
  // both with the same configId and the same parameterized case — so
  // their iterations land on the same (case, config, rowIndex) tuple.
  // Insert the May iteration FIRST so any insertion-order regression
  // would surface a non-May value; the SQL MAX must still pick May.
  // -------------------------------------------------------------------
  it("mostRecentCompletedAt: SQL MAX across iterations in the same cell, ignoring insertion order", async () => {
    const { baseDb, runMatrixAggregation, materializeForOneCase, cellKey } =
      await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-maxts-multi");
      const caseA = await createParamCase(tx, sc, "A", [{ name: "n" }]);
      await attachOwnerDataset(tx, sc, caseA, [
        { label: "r0", values: { n: "0" } },
      ]);

      // Run 1 — insert FIRST, with the LATEST completedAt (May).
      const run1 = await createRunWithCase(tx, sc, caseA, sc.chromeConfigId);
      await materializeForOneCase(sc.projectId, run1.testRunCaseId, caseA, tx);
      const iter1 = await tx.testRunCaseIteration.findFirst({
        where: { testRunCaseId: run1.testRunCaseId },
      });
      await tx.testRunCaseIteration.update({
        where: { id: iter1.id },
        data: {
          statusId: sc.passedStatusId,
          completedAt: new Date("2026-05-01T08:30:00.000Z"),
          isCompleted: true,
        },
      });

      // Run 2 — inserted SECOND but with an OLDER completedAt (April).
      const run2 = await createRunWithCase(tx, sc, caseA, sc.chromeConfigId);
      await materializeForOneCase(sc.projectId, run2.testRunCaseId, caseA, tx);
      const iter2 = await tx.testRunCaseIteration.findFirst({
        where: { testRunCaseId: run2.testRunCaseId },
      });
      await tx.testRunCaseIteration.update({
        where: { id: iter2.id },
        data: {
          statusId: sc.passedStatusId,
          completedAt: new Date("2026-04-15T12:00:00.000Z"),
          isCompleted: true,
        },
      });

      const axes = await runMatrixAggregation(tx, sc.projectId, {}, true);
      const cell = axes.cells.get(cellKey(caseA, sc.chromeConfigId, 0));
      expect(cell).toBeDefined();
      expect(cell?.iterationCount).toBe(2);
      // SQL MAX picks May — even though April was inserted second.
      expect(cell?.mostRecentCompletedAt).toBe(
        new Date("2026-05-01T08:30:00.000Z").toISOString()
      );
    });
  });

  it("mostRecentCompletedAt: cell with all-null completedAt is null", async () => {
    const { baseDb, runMatrixAggregation, materializeForOneCase, cellKey } =
      await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-maxts-null");
      const caseA = await createParamCase(tx, sc, "A", [{ name: "n" }]);
      await attachOwnerDataset(tx, sc, caseA, [
        { label: "r0", values: { n: "0" } },
      ]);
      const r = await createRunWithCase(tx, sc, caseA, sc.chromeConfigId);
      await materializeForOneCase(sc.projectId, r.testRunCaseId, caseA, tx);
      // Don't update — leave completedAt null.

      const axes = await runMatrixAggregation(tx, sc.projectId, {}, true);
      const cell = axes.cells.get(cellKey(caseA, sc.chromeConfigId, 0));
      expect(cell).toBeDefined();
      expect(cell?.mostRecentCompletedAt).toBeNull();
    });
  });

  it("mostRecentCompletedAt: per-row cell carries its iteration's completedAt as ISO string", async () => {
    const { baseDb, runMatrixAggregation, materializeForOneCase, cellKey } =
      await importDeps();
    await withRollback(baseDb, async (tx) => {
      const sc = await seedProjectScaffold(tx, "matrix-maxts-iso");
      const caseA = await createParamCase(tx, sc, "A", [{ name: "n" }]);
      await attachOwnerDataset(tx, sc, caseA, [
        { label: "r0", values: { n: "0" } },
        { label: "r1", values: { n: "1" } },
      ]);
      const r = await createRunWithCase(tx, sc, caseA, sc.chromeConfigId);
      await materializeForOneCase(sc.projectId, r.testRunCaseId, caseA, tx);
      const iters = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: r.testRunCaseId },
        orderBy: { rowIndex: "asc" },
      });
      // Update iter[0] to a SPECIFIC timestamp; leave iter[1] alone.
      const stamp = new Date("2026-05-01T08:30:00.000Z");
      await tx.testRunCaseIteration.update({
        where: { id: iters[0].id },
        data: {
          statusId: sc.passedStatusId,
          completedAt: stamp,
          isCompleted: true,
        },
      });

      const axes = await runMatrixAggregation(tx, sc.projectId, {}, true);
      const cell0 = axes.cells.get(cellKey(caseA, sc.chromeConfigId, 0));
      expect(cell0).toBeDefined();
      expect(cell0?.mostRecentCompletedAt).toBe(stamp.toISOString());

      const cell1 = axes.cells.get(cellKey(caseA, sc.chromeConfigId, 1));
      expect(cell1?.mostRecentCompletedAt).toBeNull();
    });
  });
});
