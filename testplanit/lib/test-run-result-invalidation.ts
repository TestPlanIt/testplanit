import type { QueryClient } from "@tanstack/react-query";

/**
 * ZenStack models a result write touches, directly or through a rollup.
 *
 * POST /api/test-runs/submit-result creates the TestRunResults row and
 * updates TestRunCases (status, last result), TestRunCaseIteration (rollup),
 * RepositoryCases (latest status) and TestRuns (workflow state). The clients
 * then write TestRunStepResults, Attachments and ResultFieldValues, and
 * connect Issues. Key prefix per hooks/useRepositoryCasesQuery.ts.
 */
const RESULT_MODELS = [
  "TestRunResults",
  "TestRunStepResults",
  "TestRunCases",
  "TestRunCaseIteration",
  "TestRuns",
  "RepositoryCases",
  "ResultFieldValues",
  "Attachments",
  "Issue",
];

/**
 * Non-ZenStack query roots that aggregate results: the run page summary and
 * case detail, the runs list summaries, the latest-results and dashboard
 * widgets, and the milestone progress views. Invalidating a root marks every
 * query under it stale; only the ones mounted on the current page refetch.
 */
const RESULT_QUERY_ROOTS = [
  "testRunSummary",
  "batchTestRunSummaries",
  "test-run-case-detail",
  "testRunExecutions",
  "latestTestResults",
  "testRuns",
  "completedTestRuns",
  "userDashboard",
  "milestoneSummary",
  "milestoneBurndown",
  "milestoneForecast",
  "memberIssuesRunCaseCount",
];

/**
 * Refreshes what a test result write can have changed.
 *
 * The result-submit paths go through raw fetches, so no ZenStack mutation
 * hook invalidates for them. They used to call `invalidateQueries()` with no
 * filter, which refetched every query mounted on the run page (app config,
 * user preferences, projects, workflows, templates, permissions, the
 * repository case list) and cost over a second of main-thread time per
 * submit. The repository case list follows the ZenStack invalidations below
 * on its own (hooks/useRepositoryCasesQuery.ts, seam 2).
 */
export function invalidateAfterResultSubmit(
  queryClient: QueryClient
): Promise<void> {
  return Promise.all([
    ...RESULT_MODELS.map((model) =>
      queryClient.invalidateQueries({ queryKey: ["zenstack", model] })
    ),
    ...RESULT_QUERY_ROOTS.map((root) =>
      queryClient.invalidateQueries({ queryKey: [root] })
    ),
  ]).then(() => undefined);
}
