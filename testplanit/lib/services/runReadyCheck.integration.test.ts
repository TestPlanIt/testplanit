/**
 * Live-DB integration test for the "ready to complete" predicate.
 *
 * Per feedback_prisma_helper_live_db_test: the unit tests in
 * `runReadyCheck.test.ts` stub `$queryRaw`, so they prove the branching but
 * say nothing about the SQL itself. These two hand-written queries join
 * TestRunCases and TestRunCaseIteration to Status and filter on quoted camel
 * -case columns; a typo, a renamed column, or a wrong join direction is
 * invisible until it runs against a real schema.
 *
 * The case that matters most is the parameterized one: `computeWorstOfStatus`
 * ignores iterations with no status, so a case can roll up to a completed
 * status while most of its iterations are untouched. If the iteration query
 * is wrong, that run reads as finished after its first iteration.
 *
 * Execution model:
 *   - Skipped by default. Opt-in with `RUN_DB_INTEGRATION=1`.
 *   - Requires DATABASE_URL pointing at a development/test database
 *     (the scratch `tpi_test` DB — never a production database).
 *   - Every created id is tracked and hard-deleted in `afterEach`, so the
 *     database is left exactly as it was found.
 */

import { afterEach, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("runReadyCheck — readiness predicate", () => {
  const importDeps = async () => {
    const { baseDb } = await import("~/lib/db");
    const { evaluateRunReadiness, claimRunReadyTransition } =
      await import("./runReadyCheck");
    return { baseDb, evaluateRunReadiness, claimRunReadyTransition };
  };

  const cleanup: {
    iterationIds: number[];
    testRunCaseIds: number[];
    testRunIds: number[];
    repositoryCaseIds: number[];
    repositoryFolderIds: number[];
    repositoryIds: number[];
    workflowIds: number[];
    projectIds: number[];
  } = {
    iterationIds: [],
    testRunCaseIds: [],
    testRunIds: [],
    repositoryCaseIds: [],
    repositoryFolderIds: [],
    repositoryIds: [],
    workflowIds: [],
    projectIds: [],
  };

  afterEach(async () => {
    const { baseDb } = await importDeps();
    const del = async (fn: () => Promise<unknown>) => {
      await fn().catch(() => {});
    };
    // Leaf rows first so FK constraints don't block teardown.
    if (cleanup.iterationIds.length)
      await del(() =>
        baseDb.testRunCaseIteration.deleteMany({
          where: { id: { in: cleanup.iterationIds } },
        })
      );
    if (cleanup.testRunCaseIds.length)
      await del(() =>
        baseDb.testRunCases.deleteMany({
          where: { id: { in: cleanup.testRunCaseIds } },
        })
      );
    if (cleanup.testRunIds.length)
      await del(() =>
        baseDb.testRuns.deleteMany({
          where: { id: { in: cleanup.testRunIds } },
        })
      );
    if (cleanup.repositoryCaseIds.length)
      await del(() =>
        baseDb.repositoryCases.deleteMany({
          where: { id: { in: cleanup.repositoryCaseIds } },
        })
      );
    if (cleanup.repositoryFolderIds.length)
      await del(() =>
        baseDb.repositoryFolders.deleteMany({
          where: { id: { in: cleanup.repositoryFolderIds } },
        })
      );
    if (cleanup.repositoryIds.length)
      await del(() =>
        baseDb.repositories.deleteMany({
          where: { id: { in: cleanup.repositoryIds } },
        })
      );
    if (cleanup.workflowIds.length)
      await del(() =>
        baseDb.workflows.deleteMany({
          where: { id: { in: cleanup.workflowIds } },
        })
      );
    if (cleanup.projectIds.length)
      await del(() =>
        baseDb.projects.deleteMany({
          where: { id: { in: cleanup.projectIds } },
        })
      );

    cleanup.iterationIds = [];
    cleanup.testRunCaseIds = [];
    cleanup.testRunIds = [];
    cleanup.repositoryCaseIds = [];
    cleanup.repositoryFolderIds = [];
    cleanup.repositoryIds = [];
    cleanup.workflowIds = [];
    cleanup.projectIds = [];
  });

  /** A run with one case per supplied status id (null = never executed). */
  async function seedRun(
    baseDb: any,
    caseStatusIds: Array<number | null>
  ): Promise<{ runId: number; runCaseIds: number[] }> {
    const creator = await baseDb.user.findFirst({ select: { id: true } });
    const template = await baseDb.templates.findFirst({ select: { id: true } });
    const anyColor = await baseDb.color.findFirst({ select: { id: true } });
    const anyIcon = await baseDb.fieldIcon.findFirst({ select: { id: true } });
    if (!creator || !template || !anyColor || !anyIcon) {
      throw new Error(
        "Seed the DB (user, template, color, icon) before running this integration test"
      );
    }

    const tag = `run-ready-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const project = await baseDb.projects.create({
      data: { name: tag, createdBy: creator.id },
      select: { id: true },
    });
    cleanup.projectIds.push(project.id);

    const caseState = await baseDb.workflows.create({
      data: {
        name: `${tag}-CS`,
        order: 0,
        iconId: anyIcon.id,
        colorId: anyColor.id,
        workflowType: "IN_PROGRESS",
        scope: "CASES",
      },
      select: { id: true },
    });
    cleanup.workflowIds.push(caseState.id);

    const runState = await baseDb.workflows.create({
      data: {
        name: `${tag}-RUN`,
        order: 0,
        iconId: anyIcon.id,
        colorId: anyColor.id,
        workflowType: "IN_PROGRESS",
        scope: "RUNS",
      },
      select: { id: true },
    });
    cleanup.workflowIds.push(runState.id);

    const repo = await baseDb.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    cleanup.repositoryIds.push(repo.id);

    const folder = await baseDb.repositoryFolders.create({
      data: {
        name: `${tag}-f`,
        repositoryId: repo.id,
        projectId: project.id,
        creatorId: creator.id,
      },
      select: { id: true },
    });
    cleanup.repositoryFolderIds.push(folder.id);

    const run = await baseDb.testRuns.create({
      data: {
        name: `${tag}-run`,
        projectId: project.id,
        stateId: runState.id,
        createdById: creator.id,
        testRunType: "REGULAR",
      },
      select: { id: true },
    });
    cleanup.testRunIds.push(run.id);

    const runCaseIds: number[] = [];
    for (const [index, statusId] of caseStatusIds.entries()) {
      const testCase = await baseDb.repositoryCases.create({
        data: {
          projectId: project.id,
          repositoryId: repo.id,
          folderId: folder.id,
          templateId: template.id,
          name: `${tag}-case-${index}`,
          stateId: caseState.id,
          creatorId: creator.id,
        },
        select: { id: true },
      });
      cleanup.repositoryCaseIds.push(testCase.id);

      const runCase = await baseDb.testRunCases.create({
        data: {
          testRunId: run.id,
          repositoryCaseId: testCase.id,
          order: index,
          statusId,
        },
        select: { id: true },
      });
      cleanup.testRunCaseIds.push(runCase.id);
      runCaseIds.push(runCase.id);
    }

    return { runId: run.id, runCaseIds };
  }

  /** A status flagged completed, and one that isn't (Retest/Blocked shaped). */
  async function statusPair(baseDb: any) {
    const done = await baseDb.status.findFirst({
      where: { isCompleted: true, isDeleted: false },
      select: { id: true },
    });
    const open = await baseDb.status.findFirst({
      where: { isCompleted: false, isDeleted: false },
      select: { id: true },
    });
    if (!done || !open) {
      throw new Error(
        "Seed the DB with at least one isCompleted and one non-isCompleted Status"
      );
    }
    return { doneId: done.id, openId: open.id };
  }

  it("is ready when every live case holds a completed status", async () => {
    const { baseDb, evaluateRunReadiness } = await importDeps();
    const { doneId } = await statusPair(baseDb);
    const { runId } = await seedRun(baseDb, [doneId, doneId, doneId]);

    await expect(
      evaluateRunReadiness(baseDb as never, runId)
    ).resolves.toMatchObject({ liveCases: 3, openCases: 0, isReady: true });
  });

  it("is not ready while a case has no status at all", async () => {
    const { baseDb, evaluateRunReadiness } = await importDeps();
    const { doneId } = await statusPair(baseDb);
    const { runId } = await seedRun(baseDb, [doneId, null]);

    await expect(
      evaluateRunReadiness(baseDb as never, runId)
    ).resolves.toMatchObject({ liveCases: 2, openCases: 1, isReady: false });
  });

  // Retest / Blocked / an explicitly-picked Untested all land here: a status
  // exists, but it does not mean the work is finished.
  it("is not ready while a case holds a non-completed status", async () => {
    const { baseDb, evaluateRunReadiness } = await importDeps();
    const { doneId, openId } = await statusPair(baseDb);
    const { runId } = await seedRun(baseDb, [doneId, openId]);

    await expect(
      evaluateRunReadiness(baseDb as never, runId)
    ).resolves.toMatchObject({ openCases: 1, isReady: false });
  });

  it("ignores soft-deleted cases", async () => {
    const { baseDb, evaluateRunReadiness } = await importDeps();
    const { doneId, openId } = await statusPair(baseDb);
    const { runId, runCaseIds } = await seedRun(baseDb, [doneId, openId]);

    await baseDb.testRunCases.update({
      where: { id: runCaseIds[1] },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    await expect(
      evaluateRunReadiness(baseDb as never, runId)
    ).resolves.toMatchObject({ liveCases: 1, openCases: 0, isReady: true });
  });

  it("is not ready with no live cases", async () => {
    const { baseDb, evaluateRunReadiness } = await importDeps();
    const { runId } = await seedRun(baseDb, []);

    await expect(
      evaluateRunReadiness(baseDb as never, runId)
    ).resolves.toMatchObject({ liveCases: 0, isReady: false });
  });

  // The regression this whole second query exists for.
  it("is not ready when a case rolled up to complete but its iterations did not run", async () => {
    const { baseDb, evaluateRunReadiness } = await importDeps();
    const { doneId } = await statusPair(baseDb);
    const { runId, runCaseIds } = await seedRun(baseDb, [doneId]);

    for (let i = 0; i < 10; i++) {
      const iteration = await baseDb.testRunCaseIteration.create({
        data: {
          testRunCaseId: runCaseIds[0],
          rowIndex: i,
          valuesJson: {},
          // Only the first one was actually executed.
          statusId: i === 0 ? doneId : null,
        },
        select: { id: true },
      });
      cleanup.iterationIds.push(iteration.id);
    }

    await expect(
      evaluateRunReadiness(baseDb as never, runId)
    ).resolves.toMatchObject({
      liveCases: 1,
      openCases: 0,
      openIterations: 9,
      isReady: false,
    });
  });

  it("is ready once every iteration holds a completed status", async () => {
    const { baseDb, evaluateRunReadiness } = await importDeps();
    const { doneId } = await statusPair(baseDb);
    const { runId, runCaseIds } = await seedRun(baseDb, [doneId]);

    for (let i = 0; i < 3; i++) {
      const iteration = await baseDb.testRunCaseIteration.create({
        data: {
          testRunCaseId: runCaseIds[0],
          rowIndex: i,
          valuesJson: {},
          statusId: doneId,
        },
        select: { id: true },
      });
      cleanup.iterationIds.push(iteration.id);
    }

    await expect(
      evaluateRunReadiness(baseDb as never, runId)
    ).resolves.toMatchObject({ openIterations: 0, isReady: true });
  });

  it("ignores soft-deleted iterations", async () => {
    const { baseDb, evaluateRunReadiness } = await importDeps();
    const { doneId } = await statusPair(baseDb);
    const { runId, runCaseIds } = await seedRun(baseDb, [doneId]);

    const live = await baseDb.testRunCaseIteration.create({
      data: {
        testRunCaseId: runCaseIds[0],
        rowIndex: 0,
        valuesJson: {},
        statusId: doneId,
      },
      select: { id: true },
    });
    cleanup.iterationIds.push(live.id);
    const removed = await baseDb.testRunCaseIteration.create({
      data: {
        testRunCaseId: runCaseIds[0],
        rowIndex: 1,
        valuesJson: {},
        statusId: null,
        isDeleted: true,
        deletedAt: new Date(),
      },
      select: { id: true },
    });
    cleanup.iterationIds.push(removed.id);

    await expect(
      evaluateRunReadiness(baseDb as never, runId)
    ).resolves.toMatchObject({ openIterations: 0, isReady: true });
  });

  // The one-shot claim has to hold under two workers evaluating the same run.
  it("lets exactly one concurrent caller claim the transition", async () => {
    const { baseDb, claimRunReadyTransition } = await importDeps();
    const { doneId } = await statusPair(baseDb);
    const { runId } = await seedRun(baseDb, [doneId]);

    const [a, b] = await Promise.all([
      claimRunReadyTransition(baseDb as never, runId),
      claimRunReadyTransition(baseDb as never, runId),
    ]);

    const claimed = [a, b].filter((o) => o.notify !== null);
    expect(claimed).toHaveLength(1);

    const row = await baseDb.testRuns.findUnique({
      where: { id: runId },
      select: { readyToCompleteNotifiedAt: true },
    });
    expect(row?.readyToCompleteNotifiedAt).not.toBeNull();
  });

  it("clears the marker when the run stops being ready", async () => {
    const { baseDb, claimRunReadyTransition } = await importDeps();
    const { doneId, openId } = await statusPair(baseDb);
    const { runId, runCaseIds } = await seedRun(baseDb, [doneId]);

    const first = await claimRunReadyTransition(baseDb as never, runId);
    expect(first.notify).not.toBeNull();

    // A result is deleted and the case falls back to open.
    await baseDb.testRunCases.update({
      where: { id: runCaseIds[0] },
      data: { statusId: openId },
    });
    const second = await claimRunReadyTransition(baseDb as never, runId);
    expect(second.reason).toBe("not-ready");

    const cleared = await baseDb.testRuns.findUnique({
      where: { id: runId },
      select: { readyToCompleteNotifiedAt: true },
    });
    expect(cleared?.readyToCompleteNotifiedAt).toBeNull();

    // Re-executing must notify again rather than staying silent.
    await baseDb.testRunCases.update({
      where: { id: runCaseIds[0] },
      data: { statusId: doneId },
    });
    const third = await claimRunReadyTransition(baseDb as never, runId);
    expect(third.notify).not.toBeNull();
  });
});
