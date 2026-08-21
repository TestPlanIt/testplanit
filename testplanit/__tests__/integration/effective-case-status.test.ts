/**
 * Live-DB integration test for the "EffectiveCaseStatus" view and the
 * lib/services/effectiveCaseStatus.ts helpers
 * (https://github.com/TestPlanIt/testplanit/issues/591).
 *
 * The view is the one place that knows where a run-case's completion lives —
 * TestRunCases.statusId for manual runs, JUnitTestResult for automated ones —
 * and its precedence rules (status-carrying run-case always wins; otherwise
 * latest automated attempt) ride SQL a mocked `$queryRaw` cannot validate.
 * The view is created inside each rollback transaction from its shipped
 * migration file, so this suite also fails if the migration SQL itself
 * regresses.
 *
 * Execution model mirrors milestoneMemberCoverage.integration.test.ts:
 *   - Skipped by default; opt-in with `RUN_DB_INTEGRATION=1` + `DATABASE_URL`
 *     (a scratch/seeded database — fixtures need seeded User/Workflows/
 *     Templates/MilestoneTypes/Status rows).
 *   - Every test runs inside a `baseDb.$transaction` forced to roll back, so
 *     the database is never mutated.
 */

import { describe, expect, it } from "vitest";

import { ensureEffectiveCaseStatusView } from "~/__tests__/helpers/effectiveCaseStatusView";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("EffectiveCaseStatus view (live DB)", () => {
  const importDeps = async () => {
    const { baseDb } = await import("~/lib/db");
    const { getEffectiveCaseCompletion, getEffectiveRunCaseStatuses } =
      await import("~/lib/services/effectiveCaseStatus");
    return { baseDb, getEffectiveCaseCompletion, getEffectiveRunCaseStatuses };
  };

  const ROLLBACK_SENTINEL = "__EFFECTIVE_CASE_STATUS_TEST_ROLLBACK__";

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
            await ensureEffectiveCaseStatusView(tx);
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

  async function seedLookups(tx: any) {
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("No User row available — seed the DB first");
    const state = await tx.workflows.findFirst({ select: { id: true } });
    if (!state)
      throw new Error("No Workflows row available — seed the DB first");
    const template = await tx.templates.findFirst({ select: { id: true } });
    if (!template)
      throw new Error("No Templates row available — seed the DB first");
    const milestoneType = await tx.milestoneTypes.findFirst({
      select: { id: true },
    });
    if (!milestoneType)
      throw new Error("No MilestoneTypes row available — seed the DB first");
    const passedStatus = await tx.status.findFirst({
      where: { isSuccess: true, isCompleted: true },
      select: { id: true },
    });
    const failedStatus = await tx.status.findFirst({
      where: { isFailure: true, isCompleted: true },
      select: { id: true },
    });
    if (!passedStatus || !failedStatus)
      throw new Error("No success/failure Status rows — seed the DB first");
    return {
      creator,
      state,
      template,
      milestoneType,
      passedStatus,
      failedStatus,
    };
  }

  async function createCase(
    tx: any,
    lookups: Awaited<ReturnType<typeof seedLookups>>,
    args: { projectId: number; repositoryId: number; folderId: number },
    tag: string
  ): Promise<number> {
    const testCase = await tx.repositoryCases.create({
      data: {
        projectId: args.projectId,
        repositoryId: args.repositoryId,
        folderId: args.folderId,
        templateId: lookups.template.id,
        name: `Case ${tag} ${Date.now()}`,
        stateId: lookups.state.id,
        creatorId: lookups.creator.id,
      },
      select: { id: true },
    });
    return testCase.id;
  }

  /**
   * Fixture: one milestone with a manual and an automated (MOCHA) run.
   *   - Manual run: one passed case, one never-executed case, one
   *     soft-deleted case.
   *   - Automated run: one reporter-SDK-style EMPTY run-case whose outcome
   *     lives in two JUnitTestResult attempts (older passed, newer failed);
   *     one run-case carrying an import-rollup status (passed) that a newer
   *     failed attempt must NOT override.
   *   - A deleted manual run with a passed case that must count nowhere.
   */
  async function seedFixture(tx: any) {
    const lookups = await seedLookups(tx);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const project = await tx.projects.create({
      data: { name: `ecs-${suffix}`, createdBy: lookups.creator.id },
      select: { id: true },
    });
    const repo = await tx.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    const folder = await tx.repositoryFolders.create({
      data: {
        name: `f-${suffix}`,
        repositoryId: repo.id,
        projectId: project.id,
        creatorId: lookups.creator.id,
      },
      select: { id: true },
    });
    const caseArgs = {
      projectId: project.id,
      repositoryId: repo.id,
      folderId: folder.id,
    };

    const milestone = await tx.milestones.create({
      data: {
        projectId: project.id,
        milestoneTypesId: lookups.milestoneType.id,
        name: `ms-${suffix}`,
        createdBy: lookups.creator.id,
      },
      select: { id: true },
    });

    const createRun = async (testRunType: string, isDeleted = false) =>
      (
        await tx.testRuns.create({
          data: {
            name: `run-${testRunType}-${suffix}`,
            projectId: project.id,
            stateId: lookups.state.id,
            createdById: lookups.creator.id,
            testRunType,
            milestoneId: milestone.id,
            isDeleted,
          },
          select: { id: true },
        })
      ).id;

    const manualRunId = await createRun("REGULAR");
    const automatedRunId = await createRun("MOCHA");
    const deletedRunId = await createRun("REGULAR", true);

    const createRunCase = async (
      testRunId: number,
      caseId: number,
      data: Record<string, unknown> = {}
    ) =>
      (
        await tx.testRunCases.create({
          data: { testRunId, repositoryCaseId: caseId, order: 0, ...data },
          select: { id: true },
        })
      ).id;

    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-02T00:00:00Z");

    // Manual run composition.
    const manualPassedCaseId = await createCase(tx, lookups, caseArgs, "m1");
    const manualEmptyCaseId = await createCase(tx, lookups, caseArgs, "m2");
    const manualDeletedCaseId = await createCase(tx, lookups, caseArgs, "m3");
    const manualPassedRunCaseId = await createRunCase(
      manualRunId,
      manualPassedCaseId,
      { statusId: lookups.passedStatus.id, completedAt: t0 }
    );
    const manualEmptyRunCaseId = await createRunCase(
      manualRunId,
      manualEmptyCaseId
    );
    await createRunCase(manualRunId, manualDeletedCaseId, {
      statusId: lookups.passedStatus.id,
      completedAt: t0,
      isDeleted: true,
    });

    // Automated run composition + results.
    const autoCaseId = await createCase(tx, lookups, caseArgs, "a1");
    const rollupCaseId = await createCase(tx, lookups, caseArgs, "a2");
    const autoRunCaseId = await createRunCase(automatedRunId, autoCaseId);
    const rollupRunCaseId = await createRunCase(automatedRunId, rollupCaseId, {
      statusId: lookups.passedStatus.id,
    });

    const suite = await tx.jUnitTestSuite.create({
      data: {
        name: `suite-${suffix}`,
        testRunId: automatedRunId,
        createdById: lookups.creator.id,
      },
      select: { id: true },
    });
    const createResult = async (
      caseId: number,
      type: "PASSED" | "FAILURE",
      statusId: number,
      executedAt: Date
    ) =>
      tx.jUnitTestResult.create({
        data: {
          type,
          repositoryCaseId: caseId,
          testSuiteId: suite.id,
          createdById: lookups.creator.id,
          statusId,
          executedAt,
        },
      });
    // Retry pair: the NEWER failed attempt must win for the empty run-case.
    await createResult(autoCaseId, "PASSED", lookups.passedStatus.id, t0);
    await createResult(autoCaseId, "FAILURE", lookups.failedStatus.id, t1);
    // A newer attempt disagreeing with the import rollup must NOT override it.
    await createResult(rollupCaseId, "FAILURE", lookups.failedStatus.id, t1);

    // Deleted run: its passed case must count nowhere.
    const deletedRunCaseId = await createRunCase(
      deletedRunId,
      await createCase(tx, lookups, caseArgs, "d1"),
      { statusId: lookups.passedStatus.id, completedAt: t0 }
    );

    return {
      ...lookups,
      milestoneId: milestone.id,
      manualRunId,
      automatedRunId,
      manualPassedRunCaseId,
      manualEmptyRunCaseId,
      autoRunCaseId,
      rollupRunCaseId,
      deletedRunCaseId,
      t0,
      t1,
    };
  }

  it("resolves each run-case from the correct source with the documented precedence", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);

      type ViewRow = {
        testRunCaseId: number;
        statusId: number | null;
        executedAt: Date | null;
        hasResult: boolean;
        statusSource: string | null;
      };
      const rows: ViewRow[] = await tx.$queryRaw`
        SELECT "testRunCaseId", "statusId", "executedAt", "hasResult",
               "statusSource"
        FROM "EffectiveCaseStatus"
        WHERE "testRunId" IN (${fx.manualRunId}, ${fx.automatedRunId})
      `;
      const byId = new Map(rows.map((row) => [row.testRunCaseId, row]));

      // Manual: the denormalised status, verbatim.
      expect(byId.get(fx.manualPassedRunCaseId)).toMatchObject({
        statusId: fx.passedStatus.id,
        hasResult: true,
        statusSource: "RUN_CASE",
      });
      expect(byId.get(fx.manualPassedRunCaseId)?.executedAt).toEqual(fx.t0);

      // Never executed: present (composition), but with no result. Presence
      // of the row is NOT the executed-test — hasResult is.
      expect(byId.get(fx.manualEmptyRunCaseId)).toMatchObject({
        statusId: null,
        hasResult: false,
        statusSource: null,
      });

      // Reporter-SDK empty run-case: latest automated attempt wins.
      expect(byId.get(fx.autoRunCaseId)).toMatchObject({
        statusId: fx.failedStatus.id,
        hasResult: true,
        statusSource: "AUTOMATED",
      });
      expect(byId.get(fx.autoRunCaseId)?.executedAt).toEqual(fx.t1);

      // Import-rollup status beats a newer disagreeing attempt.
      expect(byId.get(fx.rollupRunCaseId)).toMatchObject({
        statusId: fx.passedStatus.id,
        statusSource: "RUN_CASE",
      });

      // Soft-deleted run-cases and deleted runs are simply absent.
      expect(rows).toHaveLength(4);
      expect(byId.has(fx.deletedRunCaseId)).toBe(false);
    });
  });

  it("counts completion from each half's own source (manual per-case, automated per-attempt)", async () => {
    const { baseDb, getEffectiveCaseCompletion } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);

      // Manual: 2 live run-cases, 1 completed. Automated: every attempt
      // counts — 3 results, all carrying completed statuses. The deleted
      // run and the soft-deleted run-case count nowhere.
      const expected = { total: 5, completed: 4 };

      expect(
        await getEffectiveCaseCompletion({ milestoneIds: [fx.milestoneId] }, tx)
      ).toEqual(expected);
      expect(
        await getEffectiveCaseCompletion(
          { runIds: [fx.manualRunId, fx.automatedRunId] },
          tx
        )
      ).toEqual(expected);
    });
  });

  it("resolves per-run-case statuses for ORM callers through the view", async () => {
    const { baseDb, getEffectiveRunCaseStatuses } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);

      const resolved = await getEffectiveRunCaseStatuses(
        [
          fx.manualPassedRunCaseId,
          fx.manualEmptyRunCaseId,
          fx.autoRunCaseId,
          fx.rollupRunCaseId,
          fx.deletedRunCaseId,
        ],
        tx
      );

      expect(resolved.get(fx.manualPassedRunCaseId)?.id).toBe(
        fx.passedStatus.id
      );
      expect(resolved.get(fx.autoRunCaseId)?.id).toBe(fx.failedStatus.id);
      expect(resolved.get(fx.rollupRunCaseId)?.id).toBe(fx.passedStatus.id);
      // Unexecuted and deleted run-cases are absent, never null-filled.
      expect(resolved.has(fx.manualEmptyRunCaseId)).toBe(false);
      expect(resolved.has(fx.deletedRunCaseId)).toBe(false);
      // Statuses come back with their display color attached.
      expect(resolved.get(fx.autoRunCaseId)?.color).toBeDefined();
    });
  });
});
