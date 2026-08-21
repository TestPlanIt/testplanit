/**
 * Live-DB integration test for the member-coverage raw SQL — the
 * cross-project blend (other-project cases classified by their own
 * project's latest non-deleted run, viewer-scoped by accessible project
 * ids) rides `DISTINCT ON` + FILTER aggregates that a mocked `$queryRaw`
 * cannot validate: a column typo or a wrong join guard would pass every
 * unit test. (Repo rule: raw helpers need ≥1 live-DB test.)
 *
 * Execution model mirrors datasetLease.integration.test.ts:
 *   - Skipped by default; opt-in with `RUN_DB_INTEGRATION=1` + `DATABASE_URL`
 *     (a scratch/seeded dev database — the fixtures need seeded User/
 *     Workflows/Templates/MilestoneTypes/Status rows).
 *   - Every test runs inside a `baseDb.$transaction` forced to roll back, so
 *     the database is never mutated.
 */

import { describe, expect, it } from "vitest";

import { ensureEffectiveCaseStatusView } from "~/__tests__/helpers/effectiveCaseStatusView";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("getMemberCoverage cross-project blend (live DB)", () => {
  const importDeps = async () => {
    const { baseDb } = await import("~/lib/db");
    const { getMemberCoverage } = await import("./milestoneMemberCoverage");
    return { baseDb, getMemberCoverage };
  };

  const ROLLBACK_SENTINEL = "__MEMBER_COVERAGE_TEST_ROLLBACK__";

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
            // The coverage SQL reads the EffectiveCaseStatus view, which
            // `zenstack db push` does not create — build it from its
            // migration inside the rollback scope.
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

  async function createProjectWithCase(
    tx: any,
    lookups: Awaited<ReturnType<typeof seedLookups>>,
    tag: string
  ) {
    const project = await tx.projects.create({
      data: {
        name: `member-cov-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdBy: lookups.creator.id,
      },
      select: { id: true },
    });
    const repo = await tx.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    const folder = await tx.repositoryFolders.create({
      data: {
        name: `f-${tag}-${Date.now()}`,
        repositoryId: repo.id,
        projectId: project.id,
        creatorId: lookups.creator.id,
      },
      select: { id: true },
    });
    const testCase = await tx.repositoryCases.create({
      data: {
        projectId: project.id,
        repositoryId: repo.id,
        folderId: folder.id,
        templateId: lookups.template.id,
        name: `Case ${tag} ${Date.now()}`,
        stateId: lookups.state.id,
        creatorId: lookups.creator.id,
      },
      select: { id: true },
    });
    return { projectId: project.id, caseId: testCase.id };
  }

  async function createRunWithResult(
    tx: any,
    lookups: Awaited<ReturnType<typeof seedLookups>>,
    args: {
      projectId: number;
      caseId: number;
      statusId: number;
      completedAt: Date;
      milestoneId?: number;
      isDeleted?: boolean;
    }
  ) {
    const run = await tx.testRuns.create({
      data: {
        name: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        projectId: args.projectId,
        stateId: lookups.state.id,
        createdById: lookups.creator.id,
        testRunType: "REGULAR",
        milestoneId: args.milestoneId ?? null,
        isDeleted: args.isDeleted ?? false,
      },
      select: { id: true },
    });
    await tx.testRunCases.create({
      data: {
        testRunId: run.id,
        repositoryCaseId: args.caseId,
        order: 0,
        statusId: args.statusId,
        completedAt: args.completedAt,
      },
    });
  }

  /**
   * Fixture: one member issue on a milestone in project A, with linked
   * cases in three projects —
   *   - case A (home project): PASSED by a milestone-attached run; a LATER
   *     failed run NOT attached to the milestone must not override it
   *     (home-project results stay milestone-scoped, D-06).
   *   - case B (other project): FAILED by that project's latest live run; a
   *     LATER passed but soft-deleted run must be ignored.
   *   - case C (other project): no results at all.
   */
  async function seedFixture(tx: any) {
    const lookups = await seedLookups(tx);
    const a = await createProjectWithCase(tx, lookups, "a");
    const b = await createProjectWithCase(tx, lookups, "b");
    const c = await createProjectWithCase(tx, lookups, "c");

    const milestone = await tx.milestones.create({
      data: {
        projectId: a.projectId,
        milestoneTypesId: lookups.milestoneType.id,
        name: `ms-${Date.now()}`,
        createdBy: lookups.creator.id,
      },
      select: { id: true },
    });
    const issue = await tx.issue.create({
      data: {
        name: `ISS-${Date.now()}`,
        title: "Cross-project coverage fixture",
        createdById: lookups.creator.id,
      },
      select: { id: true },
    });
    await tx.milestoneIssue.create({
      data: { milestoneId: milestone.id, issueId: issue.id, source: "MANUAL" },
    });
    for (const caseId of [a.caseId, b.caseId, c.caseId]) {
      await tx.repositoryCaseIssue.create({
        data: { caseId, issueId: issue.id },
      });
    }

    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-02T00:00:00Z");
    // Case A: milestone-attached passed run, then a later off-milestone fail.
    await createRunWithResult(tx, lookups, {
      projectId: a.projectId,
      caseId: a.caseId,
      statusId: lookups.passedStatus.id,
      completedAt: t0,
      milestoneId: milestone.id,
    });
    await createRunWithResult(tx, lookups, {
      projectId: a.projectId,
      caseId: a.caseId,
      statusId: lookups.failedStatus.id,
      completedAt: t1,
    });
    // Case B: latest live run fails; a later soft-deleted pass must not win.
    await createRunWithResult(tx, lookups, {
      projectId: b.projectId,
      caseId: b.caseId,
      statusId: lookups.failedStatus.id,
      completedAt: t0,
    });
    await createRunWithResult(tx, lookups, {
      projectId: b.projectId,
      caseId: b.caseId,
      statusId: lookups.passedStatus.id,
      completedAt: t1,
      isDeleted: true,
    });

    return {
      ...lookups,
      a,
      b,
      c,
      milestoneId: milestone.id,
      issueId: issue.id,
    };
  }

  it("blends other-project results, keeps home results milestone-scoped, and ignores deleted runs", async () => {
    const { baseDb, getMemberCoverage } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);

      const coverage = await getMemberCoverage(
        fx.milestoneId,
        {
          projectId: fx.a.projectId,
          accessibleProjectIds: [fx.a.projectId, fx.b.projectId],
        },
        tx
      );
      const breakdown = coverage[fx.issueId];

      expect(breakdown).toBeDefined();
      // Case C's project is not accessible — it must not bleed in.
      expect(breakdown.linkedCaseCount).toBe(2);
      expect(breakdown.otherProjectCaseCount).toBe(1);
      // Case A passed (milestone-attached run) — the later off-milestone
      // fail must NOT reclassify it. Case B failed (latest LIVE run in its
      // own project) — the later deleted pass must NOT reclassify it.
      expect(breakdown.passed).toBe(1);
      expect(breakdown.failed).toBe(1);
      expect(breakdown.notRun).toBe(0);
      expect(breakdown.untested).toBe(0);
      const statusCounts = Object.fromEntries(
        breakdown.statuses.map((s) => [s.statusId, s.count])
      );
      expect(statusCounts[fx.passedStatus.id]).toBe(1);
      expect(statusCounts[fx.failedStatus.id]).toBe(1);
    });
  });

  it("treats a null scope as unrestricted (ADMIN) — every project's cases count", async () => {
    const { baseDb, getMemberCoverage } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);

      const coverage = await getMemberCoverage(
        fx.milestoneId,
        { projectId: fx.a.projectId, accessibleProjectIds: null },
        tx
      );
      const breakdown = coverage[fx.issueId];

      expect(breakdown.linkedCaseCount).toBe(3);
      expect(breakdown.otherProjectCaseCount).toBe(2);
      // Case C has no results anywhere — it lands in notRun/untested.
      expect(breakdown.notRun).toBe(1);
      expect(breakdown.untested).toBe(1);
    });
  });

  it("excludes every other project when the viewer can only read the milestone's own", async () => {
    const { baseDb, getMemberCoverage } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const fx = await seedFixture(tx);

      const coverage = await getMemberCoverage(
        fx.milestoneId,
        { projectId: fx.a.projectId, accessibleProjectIds: [fx.a.projectId] },
        tx
      );
      const breakdown = coverage[fx.issueId];

      expect(breakdown.linkedCaseCount).toBe(1);
      expect(breakdown.otherProjectCaseCount).toBe(0);
      expect(breakdown.passed).toBe(1);
      expect(breakdown.failed).toBe(0);
    });
  });

  async function createJunitResult(
    tx: any,
    lookups: Awaited<ReturnType<typeof seedLookups>>,
    args: {
      projectId: number;
      caseId: number;
      statusId: number;
      executedAt: Date;
      milestoneId?: number;
    }
  ) {
    const run = await tx.testRuns.create({
      data: {
        name: `junit-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        projectId: args.projectId,
        stateId: lookups.state.id,
        createdById: lookups.creator.id,
        testRunType: "REGULAR",
        milestoneId: args.milestoneId ?? null,
      },
      select: { id: true },
    });
    const suite = await tx.jUnitTestSuite.create({
      data: {
        name: "suite",
        testRunId: run.id,
        createdById: lookups.creator.id,
      },
      select: { id: true },
    });
    await tx.jUnitTestResult.create({
      data: {
        type: "PASSED",
        repositoryCaseId: args.caseId,
        testSuiteId: suite.id,
        createdById: lookups.creator.id,
        statusId: args.statusId,
        executedAt: args.executedAt,
        time: 3.2,
      },
    });
    return { runId: run.id };
  }

  it("falls back to milestone-scoped automated results when no run-case rollup exists, and never lets a deleted run's rollup decide", async () => {
    const { baseDb, getMemberCoverage } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const lookups = await seedLookups(tx);
      const home = await createProjectWithCase(tx, lookups, "jf");

      const milestone = await tx.milestones.create({
        data: {
          projectId: home.projectId,
          milestoneTypesId: lookups.milestoneType.id,
          name: `ms-junit-${Date.now()}`,
          createdBy: lookups.creator.id,
        },
        select: { id: true },
      });
      const issue = await tx.issue.create({
        data: {
          name: `ISS-JF-${Date.now()}`,
          title: "JUnit fallback fixture",
          createdById: lookups.creator.id,
        },
        select: { id: true },
      });
      await tx.milestoneIssue.create({
        data: {
          milestoneId: milestone.id,
          issueId: issue.id,
          source: "MANUAL",
        },
      });

      // Second linked case whose only rollup lives in a soft-deleted
      // milestone run — it must classify notRun, not passed.
      const repo = await tx.repositories.findFirst({
        where: { projectId: home.projectId },
        select: { id: true },
      });
      const folder = await tx.repositoryFolders.findFirst({
        where: { projectId: home.projectId },
        select: { id: true },
      });
      const deletedRunCase = await tx.repositoryCases.create({
        data: {
          projectId: home.projectId,
          repositoryId: repo.id,
          folderId: folder.id,
          templateId: lookups.template.id,
          name: `Deleted-run case ${Date.now()}`,
          stateId: lookups.state.id,
          creatorId: lookups.creator.id,
        },
        select: { id: true },
      });
      for (const caseId of [home.caseId, deletedRunCase.id]) {
        await tx.repositoryCaseIssue.create({
          data: { caseId, issueId: issue.id },
        });
      }

      // Fallback case: NO TestRunCases row anywhere. A passed automated
      // result in a milestone-attached run decides; a LATER failed
      // automated result in an OFF-milestone run must not override it.
      await createJunitResult(tx, lookups, {
        projectId: home.projectId,
        caseId: home.caseId,
        statusId: lookups.passedStatus.id,
        executedAt: new Date("2026-01-01T00:00:00Z"),
        milestoneId: milestone.id,
      });
      await createJunitResult(tx, lookups, {
        projectId: home.projectId,
        caseId: home.caseId,
        statusId: lookups.failedStatus.id,
        executedAt: new Date("2026-01-02T00:00:00Z"),
      });

      await createRunWithResult(tx, lookups, {
        projectId: home.projectId,
        caseId: deletedRunCase.id,
        statusId: lookups.passedStatus.id,
        completedAt: new Date("2026-01-01T00:00:00Z"),
        milestoneId: milestone.id,
        isDeleted: true,
      });

      const coverage = await getMemberCoverage(
        milestone.id,
        { projectId: home.projectId, accessibleProjectIds: null },
        tx
      );
      const breakdown = coverage[issue.id];

      expect(breakdown.linkedCaseCount).toBe(2);
      expect(breakdown.passed).toBe(1);
      expect(breakdown.failed).toBe(0);
      expect(breakdown.notRun).toBe(1);
      const statusCounts = Object.fromEntries(
        breakdown.statuses.map((s) => [s.statusId, s.count])
      );
      expect(statusCounts[lookups.passedStatus.id]).toBe(1);
      expect(breakdown.untested).toBe(1);
    });
  });

  it("prefers a status-carrying rollup over the automated fallback, but lets automation decide for a status-less rollup", async () => {
    const { baseDb, getMemberCoverage } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const lookups = await seedLookups(tx);
      const home = await createProjectWithCase(tx, lookups, "rw");
      const homeCase = await tx.repositoryCases.findUnique({
        where: { id: home.caseId },
        select: { repositoryId: true, folderId: true },
      });
      const fallbackCase = await tx.repositoryCases.create({
        data: {
          projectId: home.projectId,
          repositoryId: homeCase.repositoryId,
          folderId: homeCase.folderId,
          templateId: lookups.template.id,
          name: `Case rw-fallback ${Date.now()}`,
          stateId: lookups.state.id,
          creatorId: lookups.creator.id,
        },
        select: { id: true },
      });

      const milestone = await tx.milestones.create({
        data: {
          projectId: home.projectId,
          milestoneTypesId: lookups.milestoneType.id,
          name: `ms-rollup-${Date.now()}`,
          createdBy: lookups.creator.id,
        },
        select: { id: true },
      });
      const issue = await tx.issue.create({
        data: {
          name: `ISS-RW-${Date.now()}`,
          title: "Rollup-wins fixture",
          createdById: lookups.creator.id,
        },
        select: { id: true },
      });
      await tx.milestoneIssue.create({
        data: {
          milestoneId: milestone.id,
          issueId: issue.id,
          source: "MANUAL",
        },
      });
      for (const caseId of [home.caseId, fallbackCase.id]) {
        await tx.repositoryCaseIssue.create({
          data: { caseId, issueId: issue.id },
        });
      }

      // One milestone run holds both cases: a FAILED rollup for the first,
      // and a STATUS-LESS rollup for the second (the shape every automated
      // submission leaves behind). Both cases also have a NEWER passed
      // automated result. The status-carrying rollup must win despite being
      // older; the status-less one must not — presence is not the test, so
      // automation decides that case.
      const run = await tx.testRuns.create({
        data: {
          name: `rollup-run-${Date.now()}`,
          projectId: home.projectId,
          stateId: lookups.state.id,
          createdById: lookups.creator.id,
          testRunType: "REGULAR",
          milestoneId: milestone.id,
        },
        select: { id: true },
      });
      await tx.testRunCases.create({
        data: {
          testRunId: run.id,
          repositoryCaseId: home.caseId,
          order: 0,
          statusId: lookups.failedStatus.id,
          completedAt: new Date("2026-01-01T00:00:00Z"),
        },
      });
      await tx.testRunCases.create({
        data: {
          testRunId: run.id,
          repositoryCaseId: fallbackCase.id,
          order: 1,
        },
      });
      for (const caseId of [home.caseId, fallbackCase.id]) {
        await createJunitResult(tx, lookups, {
          projectId: home.projectId,
          caseId,
          statusId: lookups.passedStatus.id,
          executedAt: new Date("2026-01-02T00:00:00Z"),
          milestoneId: milestone.id,
        });
      }

      const coverage = await getMemberCoverage(
        milestone.id,
        { projectId: home.projectId, accessibleProjectIds: null },
        tx
      );
      const breakdown = coverage[issue.id];

      expect(breakdown.linkedCaseCount).toBe(2);
      expect(breakdown.failed).toBe(1);
      expect(breakdown.passed).toBe(1);
      expect(breakdown.notRun).toBe(0);
      expect(breakdown.untested).toBe(0);
    });
  });
});
