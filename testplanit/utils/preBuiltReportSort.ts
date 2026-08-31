/**
 * Client-side row ordering for the pre-built, table-shaped report types
 * (`ReportBuilder` holds their full set in memory and re-sorts in place —
 * the virtualized DataTable is `manualSorting: true`, the caller owns row
 * order). The sibling of `utils/requirementReportSort.ts`, which owns the
 * two requirement report types in `ReportRenderer`.
 *
 * The generic rule is `row[column]`: most pre-built columns are named
 * after the row property they render (`flipCount`, `passRate`,
 * `lastExecutedAt`, …) and sort correctly that way. The overrides below
 * exist for columns whose id is NOT what they display — the ids
 * themselves cannot be renamed, they key column-visibility storage,
 * grouping, and share configs:
 *
 * - issue-test-coverage `issueId` / `testCaseId` render the issue/case
 *   NAME; the raw property is the internal numeric id, so the generic
 *   rule ordered rows by database id while looking alphabetical-ish.
 * - test-case-health `healthStatus` is a closed enum this app owns;
 *   raw-string order interleaves best and worst
 *   (always_failing < always_passing < healthy < never_executed), so it
 *   sorts by a worst-first severity rank instead, the same call the
 *   requirement coverage ladder made.
 *
 * A column id with no override and no matching row property compares
 * `undefined === undefined` for every pair — `Array.prototype.sort` is
 * stable, so the rows keep their server order. That is the deliberate
 * behavior for the requirement report types, whose ordering
 * `ReportRenderer` applies itself.
 */

export interface PreBuiltReportSortConfig {
  column: string;
  direction: "asc" | "desc";
}

// Worst-first, mirroring requirementReportSort's coverage ladder.
const HEALTH_STATUS_RANK: Record<string, number> = {
  always_failing: 0,
  never_executed: 1,
  healthy: 2,
  always_passing: 3,
};

/** Strips the "cross-project-" prefix so both variants of a report type
 *  share one set of overrides (same normalization ReportBuilder and
 *  ReportRenderer apply via their own `matchesReportType`). */
function baseReportType(reportType: string): string {
  return reportType.replace(/^cross-project-/, "");
}

function sortValue(reportType: string, row: any, column: string): unknown {
  const base = baseReportType(reportType);
  if (base === "issue-test-coverage") {
    if (column === "issueId") return row.issueName ?? "";
    if (column === "testCaseId") return row.testCaseName ?? "";
  }
  if (base === "test-case-health" && column === "healthStatus") {
    return HEALTH_STATUS_RANK[row.healthStatus] ?? 99;
  }
  if (column === "project") {
    return row.project?.name || "";
  }
  return row[column];
}

/**
 * Returns a NEW array — never the input — sorted for the given config;
 * with no config the copy keeps the server order. Nulls sort last under
 * either direction (an empty cell is an absence, not a smallest value).
 */
export function sortPreBuiltReportRows<T>(
  reportType: string,
  rows: T[],
  sortConfig: PreBuiltReportSortConfig | null | undefined
): T[] {
  const sorted = [...rows];
  if (!sortConfig) {
    return sorted;
  }

  sorted.sort((a, b) => {
    const aVal = sortValue(reportType, a, sortConfig.column);
    const bVal = sortValue(reportType, b, sortConfig.column);

    if (aVal === bVal) return 0;
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;

    if (typeof aVal === "string" && typeof bVal === "string") {
      const comparison = aVal.localeCompare(bVal);
      return sortConfig.direction === "asc" ? comparison : -comparison;
    }

    const comparison = aVal < bVal ? -1 : 1;
    return sortConfig.direction === "asc" ? comparison : -comparison;
  });

  return sorted;
}
