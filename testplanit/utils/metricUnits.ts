/**
 * Single source of truth for each report metric's value unit. Rendering
 * (table cells, charts, CSV) consults this map FIRST and only falls back to
 * the historical id/label heuristics for ids not listed here — so renaming
 * or adding a metric cannot silently change how its values are formatted.
 *
 * Units:
 * - "count":   plain integer
 * - "seconds": duration expressed in seconds (the server-side contract for
 *              ALL durations — TestRunResults.elapsed, JUnitTestResult.time,
 *              and Sessions.elapsed are seconds, and report routes emit
 *              seconds unscaled)
 * - "percent": 0–100 rate; null means "no population" and renders "—"
 * - "date":    a timestamp
 */
export type MetricUnit = "count" | "seconds" | "percent" | "date";

export const METRIC_UNITS: Record<string, MetricUnit> = {
  // test-execution
  testResults: "count",
  testResultCount: "count",
  passRate: "percent",
  avgElapsed: "seconds",
  avgElapsedTime: "seconds",
  sumElapsed: "seconds",
  totalElapsedTime: "seconds",
  testRuns: "count",
  testRunCount: "count",
  testCases: "count",
  testCaseCount: "count",
  // user-engagement
  executionCount: "count",
  createdCaseCount: "count",
  sessionResultCount: "count",
  averageElapsed: "seconds",
  lastActiveDate: "date",
  // repository-stats / automation-trends
  automatedCount: "count",
  manualCount: "count",
  totalCount: "count",
  totalSteps: "count",
  averageSteps: "count",
  avgStepsPerCase: "count",
  automationRate: "percent",
  // issue-tracking
  issues: "count",
  issueCount: "count",
  // session-analysis
  sessionCount: "count",
  activeSessions: "count",
  averageDuration: "seconds",
  totalDuration: "seconds",
  // project-health
  milestoneCompletion: "percent",
  totalMilestones: "count",
  activeMilestones: "count",
  // milestone-readiness
  percentReady: "percent",
  passed: "count",
  failed: "count",
  inProgress: "count",
  notRun: "count",
  uncovered: "count",
  totalIssues: "count",
};

export function metricUnit(metricId: string): MetricUnit | undefined {
  return METRIC_UNITS[metricId];
}
