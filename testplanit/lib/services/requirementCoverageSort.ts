/**
 * The requirements domain's own coverage SORT VALUE, extracted out of
 * `requirementsListRows.ts` for exactly the reason
 * `requirementCoverageFilter.ts` was: a route handler needs this ranking to
 * sort a page server-side, and `requirementsListRows.ts` imports
 * `~/hooks/useRequirementCoverage`, a React Query hook module. A runtime
 * import of that from server code pulls React Query into a server bundle.
 *
 * PURE module: type-only imports only, by design — the same posture
 * `requirementCoverageFilter.ts` and `issueRoleScope.ts` document for
 * themselves. `RequirementCoverageBreakdown` is imported as a TYPE, which
 * TypeScript erases at compile time.
 *
 * `requirementsListRows.ts` re-exports both names below verbatim, so no
 * existing importer of that file has to move.
 */

import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";

/**
 * D-02a: this is NOT `CoverageChip.coverageSortValue`, even though the
 * coverage cell renders through `CoverageChip` itself (D-03c/UAT gap 4).
 * `coverageSortValue` ranks by a sum of completed-outcome counts; this
 * ladder ranks by `RequirementCoverageBreakdown`'s own four-rung precedence,
 * where any FAILED result anywhere in the subtree outranks NOT_RUN
 * regardless of how many cases passed. That ladder is strictly richer than a
 * sum and agrees with the chip by construction: `status === "UNCOVERED"` is
 * true exactly when `linkedCaseCount === 0`, which is exactly the chip's
 * `"no-linked-cases"` gate — the same chip/filter/sort consistency rule
 * `MemberIssuesTable.tsx` states for itself.
 */
const STATUS_RANK: Record<RequirementCoverageBreakdown["status"], number> = {
  UNCOVERED: 0,
  FAILED: 1,
  NOT_RUN: 2,
  PASSED: 3,
};

/**
 * `-1` for an absent breakdown, deliberately BELOW every real rung: a
 * requirement the rollup has no row for sorts under one it classified as
 * UNCOVERED. The server-side sort binds this same sentinel as its
 * `COALESCE` target (`requirementSortDescriptor` in `requirementTree.ts`),
 * so a requirement missing from the rollup lands in the same place whether
 * the ordering was computed here or in SQL.
 */
export function requirementCoverageSortValue(
  breakdown: RequirementCoverageBreakdown | undefined
): number {
  if (!breakdown) return -1;
  return STATUS_RANK[breakdown.status] * 10_000 + breakdown.passed;
}
