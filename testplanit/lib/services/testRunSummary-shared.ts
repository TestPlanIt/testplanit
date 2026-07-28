/**
 * Shared (client-safe) types and helpers for test-run summary data.
 *
 * Lives separately from `testRunSummary.ts` because that module imports
 * `~/lib/db`, which pulls server-only deps into client bundles. Pure
 * data shapes and aggregation helpers belong here so both the in-app
 * TestRunCasesSummary component and the test_run.completed Slack
 * formatter can call them.
 */

export type TestRunSummaryData = {
  testRunType: string;
  workflowType?: "NOT_STARTED" | "IN_PROGRESS" | "DONE" | null;
  /** For automated runs: newest imported suite/result write, falling back to
   *  the run's creation (ISO string). The runs-page Automation card uses it
   *  to stop the "importing" spinner on runs that have gone quiet. Only the
   *  batch summaries endpoint populates it. */
  lastActivityAt?: string | null;
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
    statusOrder?: number | null;
  }>;
  /**
   * Per-case iteration counts (INT-03 / D-04). Only set on the
   * `test_run.completed` webhook payload — the in-app summary UI does not
   * consume this field. Non-parameterized cases report iterationCount: 0 and
   * zeros across all four buckets.
   *
   * `redactedValuesJson` (when present) is the iteration's `valuesJson`
   * passed through `redactValues()` with `viewerCanReadSensitive=false`
   * (D-13). Cases without a snapshot (non-parameterized) omit the field.
   * The webhook payload caps each value at 4 KB (Pitfall 5).
   */
  perCaseIterationCounts?: PerCaseIterationCounts[];
};

/**
 * Public type — read by webhook emitter (testRunEvents.ts) and any future
 * consumer that needs to roll up iteration health per case without joining
 * the iteration table directly. Backed by the denormalized counter columns
 * on TestRunCases (D-14).
 */
export interface PerCaseIterationCounts {
  testRunCaseId: number;
  iterationCount: number;
  iterationsByStatus: {
    passed: number;
    failed: number;
    skipped: number;
    notRun: number;
  };
}

/**
 * Aggregate `statusCounts` into the canonical run-summary metrics shared
 * by the in-app TestRunCasesSummary component AND the test_run.completed
 * Slack formatter. Provides totals; the formatters iterate `statusCounts`
 * directly when rendering per-status rows.
 *
 *   - passed:        sum where isSuccess === true (drives green/red logic)
 *   - failed:        sum where isFailure === true (any > 0 → red bar)
 *   - completed:     sum where isCompleted === true (drives completionPct)
 *   - pending:       totalCases - completed (= cases not yet isCompleted;
 *                    Skipped IS isCompleted so it does NOT count here)
 *   - completionPct: round((completed / totalCases) * 100), capped 100
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
