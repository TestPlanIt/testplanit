/**
 * Shared (client-safe) types and helpers for test-run summary data.
 *
 * Lives separately from `testRunSummary.ts` because that module imports
 * `~/lib/prisma`, which pulls server-only deps into client bundles. Pure
 * data shapes and aggregation helpers belong here so both the in-app
 * TestRunCasesSummary component and the test_run.completed Slack
 * formatter can call them.
 */

export type TestRunSummaryData = {
  testRunType: string;
  workflowType?: "NOT_STARTED" | "IN_PROGRESS" | "DONE" | null;
  totalCases: number;
  statusCounts: Array<{
    statusId: number | null;
    statusName: string;
    colorValue: string;
    count: number;
    isCompleted?: boolean;
    isSuccess?: boolean;
    isFailure?: boolean;
  }>;
  completionRate: number;
  totalElapsed: number;
  totalEstimate: number;
  commentsCount: number;
  issues: Array<{
    id: number;
    name: string;
    title: string;
    externalId: string | null;
    externalKey: string | null;
    externalUrl: string | null;
    externalStatus: string | null;
    data: any;
    integrationId: number | null;
    lastSyncedAt: Date | null;
    issueTypeName: string | null;
    issueTypeIconUrl: string | null;
    integration: {
      id: number;
      provider: string;
      name: string;
    } | null;
    projectIds: number[];
  }>;
  // For JUnit runs
  junitSummary?: {
    totalTests: number;
    totalFailures: number;
    totalErrors: number;
    totalSkipped: number;
    totalTime: number;
    resultSegments: Array<{
      id: string;
      statusName: string;
      statusColor: string;
      resultType: string;
      count: number;
      isAggregate: boolean;
    }>;
  };
  caseDetails?: Array<{
    id: number;
    repositoryCaseId: number;
    testRunId: number;
    configurationName: string | null;
    caseName: string;
    statusId: number | null;
    statusName: string;
    colorValue: string;
    executedAt?: Date | null;
    executedByName?: string | null;
    elapsed?: number | null;
    estimate: number | null;
    isPending: boolean;
    resultCount?: number;
  }>;
};

/**
 * Aggregate `statusCounts` into the canonical run-summary buckets used by
 * the in-app TestRunCasesSummary component AND the test_run.completed
 * Slack formatter. Single source of truth so the component and the
 * webhook never disagree on what "Passed/Failed/Pending" mean.
 *
 * Bucket rules (mirror the schema's Status flags):
 *   - passed:  statusCounts where isSuccess === true (subset of completed)
 *   - failed:  statusCounts where isFailure === true (subset of completed)
 *   - completed: statusCounts where isCompleted === true (all "done" rows)
 *   - pending: totalCases - completed
 *               → catches everything not-yet-completed (untested, retest,
 *                 blocked, etc.) without per-name special-casing.
 */
export interface RunSummaryAggregates {
  totalCases: number;
  completed: number;
  passed: number;
  failed: number;
  pending: number;
  completionPct: number;
}

export function aggregateRunCounts(
  summary: Pick<TestRunSummaryData, "totalCases" | "statusCounts">
): RunSummaryAggregates {
  const completed = summary.statusCounts
    .filter((sc) => sc.isCompleted === true)
    .reduce((sum, sc) => sum + sc.count, 0);
  const passed = summary.statusCounts
    .filter((sc) => sc.isSuccess === true)
    .reduce((sum, sc) => sum + sc.count, 0);
  const failed = summary.statusCounts
    .filter((sc) => sc.isFailure === true)
    .reduce((sum, sc) => sum + sc.count, 0);
  const pending = Math.max(summary.totalCases - completed, 0);
  const completionPct =
    summary.totalCases > 0
      ? Math.min(Math.round((completed / summary.totalCases) * 100), 100)
      : 0;
  return {
    totalCases: summary.totalCases,
    completed,
    passed,
    failed,
    pending,
    completionPct,
  };
}
