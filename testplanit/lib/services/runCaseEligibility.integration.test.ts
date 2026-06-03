/**
 * Live-DB integration test for the RepositoryCases post-update hook in
 * `lib/prisma.ts` that implements the `Projects.excludeNotStartedFromRuns`
 * contract.
 *
 * Per feedback_prisma_helper_live_db_test: mocked-Prisma tests can't catch
 * unknown-column errors, FK violations, or join-shape mismatches. The
 * helper unit tests in `runCaseEligibility.test.ts` already cover the
 * pure logic with mocked tx; this file exercises the wired-up extension
 * end-to-end via `prisma.repositoryCases.update(...)` so the hook's:
 *   - cross-join through `state.workflowType`
 *   - WHERE clause shape (`results: { none: {} }`, `testRun.isCompleted: false`)
 *   - `Projects.excludeNotStartedFromRuns` column read
 *   - inner `baseClient.$transaction` wrapper
 * all survive a real Postgres schema.
 *
 * Execution model:
 *   - Skipped by default. Opt-in with `RUN_DB_INTEGRATION=1`.
 *   - Requires DATABASE_URL pointing at a development/test database.
 *   - Each test runs against COMMITTED rows (the `$extends` hook opens its
 *     own `baseClient.$transaction`, which doesn't see uncommitted outer
 *     rows), so cleanup is explicit: every created id is tracked and
 *     hard-deleted in `afterEach`. Designed to leave the DB exactly as
 *     it found it.
 */

import { afterEach, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration(
  "RepositoryCases post-update hook — excludeNotStartedFromRuns",
  () => {
    // Lazy-import so this module is pure when skipped.
    const importPrisma = async () => {
      const { prisma } = await import("~/lib/prisma");
      return prisma;
    };

    // Tracked ids for explicit cleanup. Ordered child-before-parent so
    // FK constraints don't block the teardown.
    const cleanup: {
      testRunResultIds: number[];
      testRunCaseIds: number[];
      testRunIds: number[];
      repositoryCaseIds: number[];
      repositoryFolderIds: number[];
      repositoryIds: number[];
      workflowIds: number[];
      projectIds: number[];
    } = {
      testRunResultIds: [],
      testRunCaseIds: [],
      testRunIds: [],
      repositoryCaseIds: [],
      repositoryFolderIds: [],
      repositoryIds: [],
      workflowIds: [],
      projectIds: [],
    };

    afterEach(async () => {
      const prisma = await importPrisma();
      // Order matters — clear leaf rows first.
      if (cleanup.testRunResultIds.length) {
        await prisma.testRunResults
          .deleteMany({ where: { id: { in: cleanup.testRunResultIds } } })
          .catch(() => {});
      }
      if (cleanup.testRunCaseIds.length) {
        await prisma.testRunCases
          .deleteMany({ where: { id: { in: cleanup.testRunCaseIds } } })
          .catch(() => {});
      }
      if (cleanup.testRunIds.length) {
        await prisma.testRuns
          .deleteMany({ where: { id: { in: cleanup.testRunIds } } })
          .catch(() => {});
      }
      if (cleanup.repositoryCaseIds.length) {
        await prisma.repositoryCases
          .deleteMany({ where: { id: { in: cleanup.repositoryCaseIds } } })
          .catch(() => {});
      }
      if (cleanup.repositoryFolderIds.length) {
        await prisma.repositoryFolders
          .deleteMany({ where: { id: { in: cleanup.repositoryFolderIds } } })
          .catch(() => {});
      }
      if (cleanup.repositoryIds.length) {
        await prisma.repositories
          .deleteMany({ where: { id: { in: cleanup.repositoryIds } } })
          .catch(() => {});
      }
      if (cleanup.workflowIds.length) {
        await prisma.workflows
          .deleteMany({ where: { id: { in: cleanup.workflowIds } } })
          .catch(() => {});
      }
      if (cleanup.projectIds.length) {
        await prisma.projects
          .deleteMany({ where: { id: { in: cleanup.projectIds } } })
          .catch(() => {});
      }
      cleanup.testRunResultIds = [];
      cleanup.testRunCaseIds = [];
      cleanup.testRunIds = [];
      cleanup.repositoryCaseIds = [];
      cleanup.repositoryFolderIds = [];
      cleanup.repositoryIds = [];
      cleanup.workflowIds = [];
      cleanup.projectIds = [];
    });

    /**
     * Builds the minimum fixture graph needed to exercise the hook:
     *   - project (with the eligibility flag set per the arg)
     *   - two workflow rows: one IN_PROGRESS state, one NOT_STARTED state
     *   - repository / folder / template / case under those states
     *   - test run + test run case in an open run
     * Optionally adds a TestRunResults row to make the run-case "executed".
     */
    async function seedFixture(
      prisma: any,
      args: { excludeNotStartedFromRuns: boolean; withResult?: boolean }
    ) {
      const creator = await prisma.user.findFirst({ select: { id: true } });
      if (!creator) {
        throw new Error(
          "No User row available — seed the DB before running this integration test"
        );
      }
      const template = await prisma.templates.findFirst({
        select: { id: true },
      });
      if (!template) {
        throw new Error(
          "No Templates row — seed the DB before running this integration test"
        );
      }
      const anyStatus = await prisma.status.findFirst({ select: { id: true } });
      if (!anyStatus) {
        throw new Error(
          "No Status row — seed the DB before running this integration test"
        );
      }
      const anyColor = await prisma.color.findFirst({ select: { id: true } });
      const anyIcon = await prisma.fieldIcon.findFirst({
        select: { id: true },
      });
      if (!anyColor || !anyIcon) {
        throw new Error(
          "No Color/FieldIcon row — seed the DB before running this integration test"
        );
      }

      const tag = `excl-not-started-test-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      const project = await prisma.projects.create({
        data: {
          name: tag,
          createdBy: creator.id,
          excludeNotStartedFromRuns: args.excludeNotStartedFromRuns,
        },
        select: { id: true },
      });
      cleanup.projectIds.push(project.id);

      const inProgressState = await prisma.workflows.create({
        data: {
          name: `${tag}-IP`,
          order: 1,
          iconId: anyIcon.id,
          colorId: anyColor.id,
          workflowType: "IN_PROGRESS",
          scope: "CASES",
        },
        select: { id: true },
      });
      cleanup.workflowIds.push(inProgressState.id);
      const notStartedState = await prisma.workflows.create({
        data: {
          name: `${tag}-NS`,
          order: 0,
          iconId: anyIcon.id,
          colorId: anyColor.id,
          workflowType: "NOT_STARTED",
          scope: "CASES",
        },
        select: { id: true },
      });
      cleanup.workflowIds.push(notStartedState.id);
      const runState = await prisma.workflows.create({
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

      const repo = await prisma.repositories.create({
        data: { projectId: project.id },
        select: { id: true },
      });
      cleanup.repositoryIds.push(repo.id);
      const folder = await prisma.repositoryFolders.create({
        data: {
          name: `${tag}-f`,
          repositoryId: repo.id,
          projectId: project.id,
          creatorId: creator.id,
        },
        select: { id: true },
      });
      cleanup.repositoryFolderIds.push(folder.id);

      const testCase = await prisma.repositoryCases.create({
        data: {
          projectId: project.id,
          repositoryId: repo.id,
          folderId: folder.id,
          templateId: template.id,
          name: `${tag}-case`,
          stateId: inProgressState.id,
          creatorId: creator.id,
        },
        select: { id: true },
      });
      cleanup.repositoryCaseIds.push(testCase.id);

      const testRun = await prisma.testRuns.create({
        data: {
          name: `${tag}-run`,
          projectId: project.id,
          stateId: runState.id,
          createdById: creator.id,
          testRunType: "REGULAR",
        },
        select: { id: true },
      });
      cleanup.testRunIds.push(testRun.id);
      const testRunCase = await prisma.testRunCases.create({
        data: {
          testRunId: testRun.id,
          repositoryCaseId: testCase.id,
          order: 0,
        },
        select: { id: true },
      });
      cleanup.testRunCaseIds.push(testRunCase.id);

      if (args.withResult) {
        const result = await prisma.testRunResults.create({
          data: {
            testRunId: testRun.id,
            testRunCaseId: testRunCase.id,
            statusId: anyStatus.id,
            executedById: creator.id,
          },
          select: { id: true },
        });
        cleanup.testRunResultIds.push(result.id);
      }

      return { project, testCase, testRunCase, notStartedState };
    }

    it(
      "leaves the run-case in place when the project flag is OFF",
      { timeout: 60_000 },
      async () => {
        const prisma = await importPrisma();
        const { testCase, testRunCase, notStartedState } = await seedFixture(
          prisma,
          { excludeNotStartedFromRuns: false }
        );

        await prisma.repositoryCases.update({
          where: { id: testCase.id },
          data: { stateId: notStartedState.id },
        });

        const trc = await prisma.testRunCases.findUnique({
          where: { id: testRunCase.id },
          select: { isDeleted: true },
        });
        expect(trc?.isDeleted).toBe(false);
      }
    );

    it(
      "soft-deletes the UNEXECUTED run-case when flag is ON and state transitions to NOT_STARTED",
      { timeout: 60_000 },
      async () => {
        const prisma = await importPrisma();
        const { testCase, testRunCase, notStartedState } = await seedFixture(
          prisma,
          { excludeNotStartedFromRuns: true }
        );

        await prisma.repositoryCases.update({
          where: { id: testCase.id },
          data: { stateId: notStartedState.id },
        });

        const trc = await prisma.testRunCases.findUnique({
          where: { id: testRunCase.id },
          select: { isDeleted: true },
        });
        expect(trc?.isDeleted).toBe(true);
      }
    );

    it(
      "LEAVES an EXECUTED run-case in place even when the flag is ON (lock, don't delete)",
      { timeout: 60_000 },
      async () => {
        const prisma = await importPrisma();
        const { testCase, testRunCase, notStartedState } = await seedFixture(
          prisma,
          { excludeNotStartedFromRuns: true, withResult: true }
        );

        await prisma.repositoryCases.update({
          where: { id: testCase.id },
          data: { stateId: notStartedState.id },
        });

        const trc = await prisma.testRunCases.findUnique({
          where: { id: testRunCase.id },
          select: { isDeleted: true },
        });
        // Per the design decision baked into the hook's `results: { none: {} }`
        // predicate: any run-case that already has a recorded TestRunResults
        // row stays in the run so the recorded outcome remains visible.
        expect(trc?.isDeleted).toBe(false);
      }
    );

    // `softDeleteUnexecutedRunCasesForDraftRevert` is the same logic factored
    // out for the auto-API route handler (which bypasses lib/prisma.ts's
    // $extends hooks). Per feedback_prisma_helper_live_db_test it needs its
    // own live-DB coverage — mocked-Prisma tests can't catch unknown-column
    // errors, FK violations, or join-shape mismatches in the WHERE predicate.
    it(
      "softDeleteUnexecutedRunCasesForDraftRevert returns the soft-delete count and respects the executed-lock predicate against real Postgres",
      { timeout: 60_000 },
      async () => {
        const prisma = await importPrisma();
        const { softDeleteUnexecutedRunCasesForDraftRevert } =
          await import("~/lib/services/runCaseEligibility");

        const { testCase, testRunCase, notStartedState } = await seedFixture(
          prisma,
          { excludeNotStartedFromRuns: true }
        );

        const count = await softDeleteUnexecutedRunCasesForDraftRevert(
          prisma as never,
          {
            projectId: testCase.id
              ? (await prisma.repositoryCases.findUnique({
                  where: { id: testCase.id },
                  select: { projectId: true },
                }))!.projectId
              : 0,
            repositoryCaseId: testCase.id,
            newStateId: notStartedState.id,
          }
        );

        expect(count).toBe(1);

        const trc = await prisma.testRunCases.findUnique({
          where: { id: testRunCase.id },
          select: { isDeleted: true },
        });
        expect(trc?.isDeleted).toBe(true);
      }
    );

    it(
      "softDeleteUnexecutedRunCasesForDraftRevert leaves an EXECUTED run-case in place against real Postgres",
      { timeout: 60_000 },
      async () => {
        const prisma = await importPrisma();
        const { softDeleteUnexecutedRunCasesForDraftRevert } =
          await import("~/lib/services/runCaseEligibility");

        const { testCase, testRunCase, notStartedState } = await seedFixture(
          prisma,
          { excludeNotStartedFromRuns: true, withResult: true }
        );

        const projectId = (await prisma.repositoryCases.findUnique({
          where: { id: testCase.id },
          select: { projectId: true },
        }))!.projectId;

        const count = await softDeleteUnexecutedRunCasesForDraftRevert(
          prisma as never,
          {
            projectId,
            repositoryCaseId: testCase.id,
            newStateId: notStartedState.id,
          }
        );

        // Executed run-cases never match the predicate, so the count is 0
        // and the row stays in place.
        expect(count).toBe(0);
        const trc = await prisma.testRunCases.findUnique({
          where: { id: testRunCase.id },
          select: { isDeleted: true },
        });
        expect(trc?.isDeleted).toBe(false);
      }
    );
  }
);
