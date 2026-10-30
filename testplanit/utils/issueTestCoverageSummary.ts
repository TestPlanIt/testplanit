/**
 * The Issue Test Coverage chart's numbers, computed once over the full
 * filtered row set: the headline tiles, the bubble buckets of the
 * coverage-vs-execution chart, and the axis maxima. The server returns
 * this beside a page of rows; the chart falls back to computing it from
 * the rows it has (payloads captured before the summary existed).
 *
 * Pure: no database or framework imports, shared by the route handler and
 * the client chart. The arithmetic here is the chart's own, moved verbatim.
 */

export type IssueCoverageBubbleStatus = "failed" | "untested" | "passing";

export interface IssueCoverageBubble {
  /** Bucketed linked-case count (the x position). */
  linkedTests: number;
  /** Bucketed untested-case count (the y position). */
  untestedTests: number;
  status: IssueCoverageBubbleStatus;
  /** Issues in this bucket (the bubble's size). */
  count: number;
}

export interface IssueTestCoverageSummary {
  totalIssues: number;
  totalLinkedTests: number;
  totalPassed: number;
  totalFailed: number;
  totalUntested: number;
  issuesWithFailures: number;
  issuesAllPassing: number;
  issuesWithUntested: number;
  /** Passed over passed + failed, rounded; 0 when nothing has run. */
  overallPassRate: number;
  /** Axis maxima of the bubble chart (at least 1). */
  maxLinkedTests: number;
  maxUntestedTests: number;
  bubbles: IssueCoverageBubble[];
}

interface IssueLikeRow {
  issueId?: number | null;
  linkedTestCases?: number | null;
  passedTestCases?: number | null;
  failedTestCases?: number | null;
  untestedTestCases?: number | null;
}

/** One entry per issue, first row wins (every row of an issue carries the
 *  same issue-level counts). */
export function aggregateIssueRows<T extends IssueLikeRow>(
  rows: ReadonlyArray<T | null | undefined>
): T[] {
  const byIssue = new Map<number, T>();
  for (const row of rows) {
    if (!row || typeof row.issueId !== "number") continue;
    if (!byIssue.has(row.issueId)) byIssue.set(row.issueId, row);
  }
  return [...byIssue.values()];
}

// Bucket a count the way the chart lays out its axes:
// 0-5, 6-10, 11-20, 21-50, 51-100, 101-200, then rounded to 50s.
function bucket(count: number): number {
  if (count <= 5) return 2.5;
  if (count <= 10) return 8;
  if (count <= 20) return 15;
  if (count <= 50) return 35;
  if (count <= 100) return 75;
  if (count <= 200) return 150;
  return Math.round(count / 50) * 50;
}

export function summarizeIssueTestCoverage(
  rows: ReadonlyArray<IssueLikeRow | null | undefined>
): IssueTestCoverageSummary {
  const issues = aggregateIssueRows(rows);

  let totalLinkedTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalUntested = 0;
  let issuesWithFailures = 0;
  let issuesAllPassing = 0;
  let issuesWithUntested = 0;
  let maxLinkedTests = 1;
  let maxUntestedTests = 1;
  const bubbleMap = new Map<string, IssueCoverageBubble>();

  for (const issue of issues) {
    const linked = issue.linkedTestCases || 0;
    const passed = issue.passedTestCases || 0;
    const failed = issue.failedTestCases || 0;
    const untested = issue.untestedTestCases || 0;

    totalLinkedTests += linked;
    totalPassed += passed;
    totalFailed += failed;
    totalUntested += untested;
    if (failed > 0) issuesWithFailures++;
    if (passed > 0 && failed === 0 && untested === 0) issuesAllPassing++;
    if (untested > 0) issuesWithUntested++;
    if (linked > maxLinkedTests) maxLinkedTests = linked;
    if (untested > maxUntestedTests) maxUntestedTests = untested;

    const status: IssueCoverageBubbleStatus =
      failed > 0 ? "failed" : untested > 0 ? "untested" : "passing";
    const linkedBucket = bucket(linked);
    const untestedBucket = bucket(untested);
    const key = `${linkedBucket}-${untestedBucket}-${status}`;
    let point = bubbleMap.get(key);
    if (!point) {
      point = {
        linkedTests: linkedBucket,
        untestedTests: untestedBucket,
        status,
        count: 0,
      };
      bubbleMap.set(key, point);
    }
    point.count++;
  }

  return {
    totalIssues: issues.length,
    totalLinkedTests,
    totalPassed,
    totalFailed,
    totalUntested,
    issuesWithFailures,
    issuesAllPassing,
    issuesWithUntested,
    overallPassRate:
      totalPassed + totalFailed > 0
        ? Math.round((totalPassed / (totalPassed + totalFailed)) * 100)
        : 0,
    maxLinkedTests,
    maxUntestedTests,
    bubbles: [...bubbleMap.values()],
  };
}
