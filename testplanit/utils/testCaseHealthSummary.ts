/**
 * The Test Case Health chart's numbers, computed once over the full
 * filtered set. The server returns this beside a page of rows so the
 * client never needs every row to draw the chart; the chart falls back
 * to computing it from the rows it has (static share payloads captured
 * before the summary existed).
 *
 * Pure: no database or framework imports, so both the route handler and
 * the client chart can share it.
 */

export type HealthStatus =
  "healthy" | "never_executed" | "always_passing" | "always_failing";

export interface TestCaseHealthSummary {
  /** Rows in the filtered set. */
  total: number;
  /** Rows per health status. */
  counts: Record<HealthStatus, number>;
  /** Rows flagged stale (a flag, orthogonal to status). */
  staleCount: number;
  /** always_failing + never_executed + stale. */
  needsAttention: number;
  /** healthy + always_passing. */
  healthy: number;
  /** Mean health score, rounded; 0 for an empty set. */
  avgHealthScore: number;
}

interface SummarizableRow {
  healthStatus?: HealthStatus | string | null;
  isStale?: boolean | null;
  healthScore?: number | null;
}

export const EMPTY_TEST_CASE_HEALTH_SUMMARY: TestCaseHealthSummary = {
  total: 0,
  counts: {
    healthy: 0,
    never_executed: 0,
    always_passing: 0,
    always_failing: 0,
  },
  staleCount: 0,
  needsAttention: 0,
  healthy: 0,
  avgHealthScore: 0,
};

export function summarizeTestCaseHealth(
  rows: ReadonlyArray<SummarizableRow | null | undefined>
): TestCaseHealthSummary {
  const counts: Record<HealthStatus, number> = {
    healthy: 0,
    never_executed: 0,
    always_passing: 0,
    always_failing: 0,
  };
  let staleCount = 0;
  let scoreSum = 0;
  let scored = 0;

  for (const row of rows) {
    if (!row) continue;
    const status = row.healthStatus as HealthStatus | undefined;
    if (status && counts[status] !== undefined) {
      counts[status]++;
    }
    if (typeof row.healthScore === "number") {
      scored++;
      scoreSum += row.healthScore;
      if (row.isStale) staleCount++;
    }
  }

  return {
    total: rows.length,
    counts,
    staleCount,
    needsAttention: counts.always_failing + counts.never_executed + staleCount,
    healthy: counts.healthy + counts.always_passing,
    avgHealthScore: scored > 0 ? Math.round(scoreSum / scored) : 0,
  };
}
