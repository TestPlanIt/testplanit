/**
 * Live-DB integration test for the hybrid-run projection
 * (lib/services/hybridRunProjection.ts + its sideEffectsPlugin hooks).
 *
 * A REGULAR run that receives automated results through the plugin-enabled
 * client (the reporter SDK path: JUnitTestSuite + JUnitTestResult creates)
 * must be promoted to HYBRID and have each result mirrored onto its run-case
 * row, so the manual UI, progress bar and ready-to-complete check describe
 * it. Pure automated runs must be left alone. This rides the plugin's
 * afterEntityMutation wiring and real FK/trigger behaviour, which a mocked
 * client cannot validate.
 *
 * Execution model mirrors effective-case-status.test.ts:
 *   - Skipped by default; opt-in with `RUN_DB_INTEGRATION=1` + `DATABASE_URL`
 *     (a scratch/seeded database — never ew).
 *   - Every test runs inside a `baseDb.$transaction` forced to roll back.
 */

import { describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("Hybrid-run projection (live DB)", () => {
  const ROLLBACK_SENTINEL = "__HYBRID_RUN_PROJECTION_TEST_ROLLBACK__";

  async function withRollback<T>(
    body: (tx: any) => Promise<T>,
    timeoutMs = 60_000
  ): Promise<T> {
    const { baseDb } = (await import("~/lib/db")) as { baseDb: any };
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

  async function seedFixture(tx: any, testRunType: string) {
    const creator = await tx.user.findFirst({ select: { id: true } });
    const state = await tx.workflows.findFirst({ select: { id: true } });
    const template = await tx.templates.findFirst({ select: { id: true } });
    const passedStatus = await tx.status.findFirst({
      where: { isSuccess: true, isCompleted: true },
      select: { id: true },
    });
    const failedStatus = await tx.status.findFirst({
      where: { isFailure: true, isCompleted: true },
      select: { id: true },
    });
    if (!creator || !state || !template || !passedStatus || !failedStatus)
      throw new Error(
        "Seed the database first (User/Workflows/Templates/Status)"
      );

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const project = await tx.projects.create({
      data: { name: `hybrid-${suffix}`, createdBy: creator.id },
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
        creatorId: creator.id,
      },
      select: { id: true },
    });
    const createCase = async (tag: string) =>
      (
        await tx.repositoryCases.create({
          data: {
            projectId: project.id,
            repositoryId: repo.id,
            folderId: folder.id,
            templateId: template.id,
            name: `Case ${tag} ${suffix}`,
            stateId: state.id,
            creatorId: creator.id,
            automated: true,
          },
          select: { id: true },
        })
      ).id;

    const run = await tx.testRuns.create({
      data: {
        name: `run-${suffix}`,
        projectId: project.id,
        stateId: state.id,
        createdById: creator.id,
        testRunType,
      },
      select: { id: true },
    });

    const inRunCaseId = await createCase("in-run");
    const manualCaseId = await createCase("manual");
    const notInRunCaseId = await createCase("not-in-run");
    const inRunRunCase = await tx.testRunCases.create({
      data: { testRunId: run.id, repositoryCaseId: inRunCaseId, order: 0 },
      select: { id: true },
    });
    const manualRunCase = await tx.testRunCases.create({
      data: { testRunId: run.id, repositoryCaseId: manualCaseId, order: 1 },
      select: { id: true },
    });

    const suite = await tx.jUnitTestSuite.create({
      data: {
        name: `suite-${suffix}`,
        testRunId: run.id,
        createdById: creator.id,
      },
      select: { id: true },
    });
    const createResult = (
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
          createdById: creator.id,
          statusId,
          executedAt,
        },
      });

    // A tester recording a result in the UI. Mirrors the legacy
    // (non-iteration) branch of app/api/test-runs/submit-result/route.ts:
    // the TestRunResults row plus the direct status write onto the run-case.
    // The route's surrounding work (auth, required fields, review gates) is
    // irrelevant to which result ends up owning the run-case row.
    const recordManualResult = async (
      runCaseId: number,
      statusId: number,
      executedAt: Date
    ) => {
      await tx.testRunResults.create({
        data: {
          testRunId: run.id,
          testRunCaseId: runCaseId,
          statusId,
          executedById: creator.id,
          executedAt,
        },
      });
      await tx.testRunCases.update({
        where: { id: runCaseId },
        data: { statusId },
      });
    };

    return {
      runId: run.id,
      creatorId: creator.id,
      inRunCaseId,
      inRunRunCaseId: inRunRunCase.id,
      manualRunCaseId: manualRunCase.id,
      notInRunCaseId,
      passedStatus,
      failedStatus,
      createResult,
      recordManualResult,
    };
  }

  it("promotes a REGULAR run to HYBRID on the first suite and mirrors each result onto its run-case (latest wins)", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx, "REGULAR");

      // The suite create alone promotes the run.
      const afterSuite = await tx.testRuns.findUnique({
        where: { id: f.runId },
        select: { testRunType: true },
      });
      expect(afterSuite?.testRunType).toBe("HYBRID");

      await f.createResult(
        f.inRunCaseId,
        "PASSED",
        f.passedStatus.id,
        new Date("2026-01-01T00:00:00Z")
      );
      let runCase = await tx.testRunCases.findUnique({
        where: { id: f.inRunRunCaseId },
        select: { statusId: true, isCompleted: true, completedAt: true },
      });
      expect(runCase?.statusId).toBe(f.passedStatus.id);
      expect(runCase?.isCompleted).toBe(true);
      expect(runCase?.completedAt).not.toBeNull();

      // A newer failed attempt overwrites — the newest result wins.
      await f.createResult(
        f.inRunCaseId,
        "FAILURE",
        f.failedStatus.id,
        new Date("2026-01-02T00:00:00Z")
      );
      runCase = await tx.testRunCases.findUnique({
        where: { id: f.inRunRunCaseId },
        select: { statusId: true },
      });
      expect(runCase?.statusId).toBe(f.failedStatus.id);

      // The untouched manual case keeps no status.
      const manual = await tx.testRunCases.findUnique({
        where: { id: f.manualRunCaseId },
        select: { statusId: true, isCompleted: true },
      });
      expect(manual?.statusId).toBeNull();
      expect(manual?.isCompleted).toBe(false);

      // A result for a case that is not in the run is kept and adds nothing.
      await f.createResult(
        f.notInRunCaseId,
        "PASSED",
        f.passedStatus.id,
        new Date("2026-01-03T00:00:00Z")
      );
      const membership = await tx.testRunCases.count({
        where: { testRunId: f.runId },
      });
      expect(membership).toBe(2);
    });
  });

  it("leaves a pure automated run untouched", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx, "JUNIT");
      await f.createResult(
        f.inRunCaseId,
        "PASSED",
        f.passedStatus.id,
        new Date("2026-01-01T00:00:00Z")
      );
      const run = await tx.testRuns.findUnique({
        where: { id: f.runId },
        select: { testRunType: true },
      });
      expect(run?.testRunType).toBe("JUNIT");
      const runCase = await tx.testRunCases.findUnique({
        where: { id: f.inRunRunCaseId },
        select: { statusId: true },
      });
      expect(runCase?.statusId).toBeNull();
    });
  });

  it("does not overwrite a run-case whose status comes from an iteration rollup", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx, "HYBRID");
      await tx.testRunCases.update({
        where: { id: f.inRunRunCaseId },
        data: { totalIterations: 2, statusId: f.passedStatus.id },
      });
      await f.createResult(
        f.inRunCaseId,
        "FAILURE",
        f.failedStatus.id,
        new Date("2026-01-02T00:00:00Z")
      );
      const runCase = await tx.testRunCases.findUnique({
        where: { id: f.inRunRunCaseId },
        select: { statusId: true },
      });
      expect(runCase?.statusId).toBe(f.passedStatus.id);
    });
  });

  it("newest result wins in BOTH directions on a hybrid run-case, and neither history is discarded", async () => {
    await withRollback(async (tx) => {
      const { getCaseLatestExecutedAt } =
        await import("~/lib/services/latestCaseResults");
      const f = await seedFixture(tx, "HYBRID");
      const t1 = new Date("2026-03-01T00:00:00Z"); // CI
      const t2 = new Date("2026-03-02T00:00:00Z"); // tester
      const t3 = new Date("2026-03-03T00:00:00Z"); // CI again

      const runCaseNow = () =>
        tx.testRunCases.findUnique({
          where: { id: f.inRunRunCaseId },
          select: { statusId: true, isCompleted: true, completedAt: true },
        });
      const latestExecutedAt = async () =>
        (await getCaseLatestExecutedAt([f.inRunCaseId], tx))
          .get(f.inRunCaseId)
          ?.toISOString();

      // ── t1: CI reports a pass ────────────────────────────────────────
      await f.createResult(f.inRunCaseId, "PASSED", f.passedStatus.id, t1);
      expect((await runCaseNow())?.statusId).toBe(f.passedStatus.id);
      expect(await latestExecutedAt()).toBe(t1.toISOString());

      // ── t2: a tester records a manual failure on the same case ───────
      // The manual write is the newest, so it owns the run-case row —
      // the automated projection must not claw it back.
      await f.recordManualResult(f.inRunRunCaseId, f.failedStatus.id, t2);
      const afterManual = await runCaseNow();
      expect(afterManual?.statusId).toBe(f.failedStatus.id);
      expect(await latestExecutedAt()).toBe(t2.toISOString());
      // `isCompleted` / `completedAt` are deliberately NOT asserted here:
      // the manual legacy branch writes only `statusId`, so on a run-case
      // that an automated result already touched those two columns still
      // describe the automated write. Completion is derived from
      // `Status.isCompleted` via `statusId` everywhere it matters
      // (lib/services/runReadyCheck.ts), so pinning the stale values here
      // would freeze an inconsistency rather than document a contract.
      // The automated history is evidence, not a cache: the JUnit suite and
      // its result survive the manual submission untouched.
      expect(
        await tx.jUnitTestResult.count({
          where: { repositoryCaseId: f.inRunCaseId },
        })
      ).toBe(1);
      expect(
        await tx.jUnitTestSuite.count({
          where: { testRunId: f.runId },
        })
      ).toBe(1);
      // A manual result on a hybrid run never demotes it back to REGULAR.
      expect(
        (
          await tx.testRuns.findUnique({
            where: { id: f.runId },
            select: { testRunType: true },
          })
        )?.testRunType
      ).toBe("HYBRID");

      // ── t3: a newer CI run lands ─────────────────────────────────────
      // Symmetry: the projection overwrites a tester's status exactly as the
      // tester overwrote CI's, because it is now the newest result.
      await f.createResult(f.inRunCaseId, "PASSED", f.passedStatus.id, t3);
      const afterAutomated = await runCaseNow();
      expect(afterAutomated?.statusId).toBe(f.passedStatus.id);
      expect(afterAutomated?.isCompleted).toBe(true);
      expect(afterAutomated?.completedAt).not.toBeNull();
      expect(await latestExecutedAt()).toBe(t3.toISOString());
      // Both histories are still whole — two automated results and the one
      // manual result the tester recorded.
      expect(
        await tx.jUnitTestResult.count({
          where: { repositoryCaseId: f.inRunCaseId },
        })
      ).toBe(2);
      expect(
        await tx.testRunResults.count({
          where: { testRunCaseId: f.inRunRunCaseId, isDeleted: false },
        })
      ).toBe(1);
    });
  });
});
