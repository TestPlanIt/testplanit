/**
 * Hybrid-run projection.
 *
 * A REGULAR run can receive automated (JUnit-family) results — from a
 * dispatched execution, a reporter pinned with TESTPLANIT_RUN_ID, or an
 * import. Two things keep the manual side of the product truthful when that
 * happens:
 *
 *  1. The run is promoted to HYBRID on its first automated write, so the run
 *     page, filters and summaries know to show both trees.
 *  2. Every automated result is projected onto the run-case row
 *     (TestRunCases.statusId / isCompleted / completedAt), exactly as the
 *     import route already does for the legacy (non-iteration) branch. Latest
 *     write wins, whether it came from CI or from a tester.
 *
 * Both run inside the caller's transaction. The import route calls them
 * directly; the reporter path reaches them through the JUnitTestSuite /
 * JUnitTestResult create side effects in sideEffectsPlugin.
 */

import { MANUAL_TEST_RUN_TYPES } from "~/utils/testResultTypes";

type ProjectionClient = {
  testRuns: {
    updateMany: (args: {
      where: { id: number; testRunType: "REGULAR"; isDeleted: boolean };
      data: { testRunType: "HYBRID" };
    }) => Promise<{ count: number }>;
  };
  jUnitTestSuite: {
    findUnique: (args: {
      where: { id: number };
      select: {
        testRun: { select: { id: true; testRunType: true; isDeleted: true } };
      };
    }) => Promise<{
      testRun: { id: number; testRunType: string; isDeleted: boolean } | null;
    } | null>;
  };
  testRunCases: {
    findFirst: (args: {
      where: {
        testRunId: number;
        repositoryCaseId: number;
        isDeleted: boolean;
      };
      select: { id: true; totalIterations: true };
    }) => Promise<{ id: number; totalIterations: number } | null>;
    update: (args: {
      where: { id: number };
      data: { statusId: number; isCompleted: boolean; completedAt: Date };
    }) => Promise<unknown>;
  };
};

/**
 * Flip a REGULAR run to HYBRID. A no-op for every other type (including runs
 * that are already HYBRID), so it is safe to call on every automated write.
 * Returns true when the row actually changed.
 */
export async function promoteRunToHybrid(
  client: ProjectionClient,
  testRunId: number
): Promise<boolean> {
  const result = await client.testRuns.updateMany({
    where: { id: testRunId, testRunType: "REGULAR", isDeleted: false },
    data: { testRunType: "HYBRID" },
  });
  return result.count > 0;
}

export type JUnitResultProjectionRow = {
  testSuiteId: number;
  repositoryCaseId: number | null;
  statusId: number | null;
};

/**
 * Project a freshly created JUnitTestResult onto its run-case row when the
 * owning run is manual (REGULAR or HYBRID). Pure automated runs are left
 * alone: their UI and summaries read JUnitTestResult directly.
 *
 * Skips run-cases that have iterations — for those the import route's
 * iteration router owns the case-level rollup and would otherwise be
 * overwritten by the single result that arrived last.
 */
export async function projectJUnitResultOntoRunCase(
  client: ProjectionClient,
  row: JUnitResultProjectionRow
): Promise<void> {
  if (row.repositoryCaseId == null) return;

  const suite = await client.jUnitTestSuite.findUnique({
    where: { id: row.testSuiteId },
    select: {
      testRun: { select: { id: true, testRunType: true, isDeleted: true } },
    },
  });
  const run = suite?.testRun;
  if (!run || run.isDeleted) return;
  if (!MANUAL_TEST_RUN_TYPES.includes(run.testRunType as "REGULAR" | "HYBRID"))
    return;

  if (run.testRunType === "REGULAR") {
    await promoteRunToHybrid(client, run.id);
  }

  if (row.statusId == null) return;

  const runCase = await client.testRunCases.findFirst({
    where: {
      testRunId: run.id,
      repositoryCaseId: row.repositoryCaseId,
      isDeleted: false,
    },
    select: { id: true, totalIterations: true },
  });
  if (!runCase || runCase.totalIterations > 0) return;

  await client.testRunCases.update({
    where: { id: runCase.id },
    data: {
      statusId: row.statusId,
      isCompleted: true,
      completedAt: new Date(),
    },
  });
}
