import { formatRequirementCellText } from "~/utils/issueDisplayText";

/**
 * Client-side row ordering for the two requirement report types.
 *
 * The virtualized DataTable runs `manualSorting: true` — its own doc
 * comment says THE CALLER owns row order (server orderBy or its own sort
 * of `data`), and `sortConfig` is display state only. The requirement
 * report handlers return the full matrix in path order and ignore
 * `sortColumn`, so until this module existed a sort click updated the
 * header chrome and reordered nothing. The full set is already in memory
 * (these reports never server-paginate), so sorting belongs here, next to
 * the data, rather than as a 30k-row refetch per header click.
 *
 * Keyed by COLUMN ID (the ids `useRequirementCoverageReportColumns.tsx`
 * assigns), returning the value each column visibly renders — the test
 * case column sorts by the case NAME it displays, never the accessor's
 * numeric id; the coverage column sorts by the classification ladder's
 * own severity order (uncovered → failed → not run → passed), not
 * alphabetically. An unknown column id returns the rows untouched.
 *
 * `Array.prototype.sort` is stable, and rows arrive in the server's
 * path-then-case order — so ties keep that order without an explicit
 * tiebreaker.
 */

export interface RequirementReportSortConfig {
  column: string;
  direction: "asc" | "desc";
}

const COVERAGE_SEVERITY_RANK: Record<string, number> = {
  UNCOVERED: 0,
  FAILED: 1,
  NOT_RUN: 2,
  PASSED: 3,
};

function sortValue(row: any, column: string): string | number | null {
  switch (column) {
    case "requirement":
      return formatRequirementCellText(row);
    case "requirementPath":
      // The column displays the ancestors-only path, so it sorts by it too.
      return row.requirementParentPath ?? "";
    case "coverage":
      return COVERAGE_SEVERITY_RANK[row.coverageStatus] ?? 99;
    case "testCaseId":
      return row.testCaseName ?? "";
    case "result":
      return row.lastStatusName ?? "";
    case "executedAt":
      return row.lastExecutedAt ? Date.parse(row.lastExecutedAt) : 0;
    case "project":
      return row.caseProjectName ?? "";
    case "linkedCases":
      return row.linkedCases ?? 0;
    case "priority":
      // localeCompare, never a rank map — priority vocabularies are
      // per-project tracker strings (recorded D-17 decision).
      return row.requirementPriority ?? "";
    case "status":
      return row.requirementStatus ?? "";
    case "uncoveredSince":
      return row.requirementCreatedAt
        ? Date.parse(row.requirementCreatedAt)
        : 0;
    default:
      return null;
  }
}

export function sortRequirementReportRows<T>(
  rows: T[],
  sort: RequirementReportSortConfig | null | undefined
): T[] {
  if (!sort || sortValue(rows[0] ?? {}, sort.column) === null) {
    return rows;
  }
  const direction = sort.direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.column);
    const vb = sortValue(b, sort.column);
    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * direction;
    }
    return String(va ?? "").localeCompare(String(vb ?? "")) * direction;
  });
}
