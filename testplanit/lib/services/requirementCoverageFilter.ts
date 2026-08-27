/**
 * The requirements domain's own coverage-axis filter predicate, extracted
 * out of `requirementsListRows.ts` (28-12) so a route handler can share
 * exactly one implementation with the client instead of growing a second
 * one that drifts.
 *
 * PURE module: type-only imports only, by design -- the same posture
 * `issueRoleScope.ts` documents for itself. `requirementsListRows.ts`
 * imports `~/hooks/useRequirementCoverage`, a React Query hook module; a
 * runtime import of anything like that here would pull React Query into a
 * server bundle the moment a route handler imported this predicate. This
 * module's only dependency, `RequirementCoverageBreakdown`, is imported as
 * a TYPE, which TypeScript erases at compile time -- it costs nothing at
 * runtime and does not disqualify this module from being imported by
 * server code.
 *
 * `requirementsListRows.ts` re-exports both names below verbatim, so no
 * existing importer of that file has to move.
 */

import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";

/**
 * "" means "not filtering on this axis" throughout, mirroring the milestone
 * comparator's own convention (`MemberIssuesTable.tsx`'s
 * `CoverageStateFilter`/`SourceFilter`). Coverage's non-empty states are the
 * requirements domain's own definitions (plan 10's chip, the shipped gap
 * report), NOT the milestone's "no completed outcome" --
 * `matchesRequirementCoverageFilter` says so explicitly below.
 */
export type RequirementCoverageFilter =
  "" | "UNCOVERED" | "UNTESTED" | `status:${number}`;

/**
 * The requirements domain's own coverage-state predicate -- deliberately NOT
 * `MemberIssuesTable.tsx`'s `matchesCoverageState`, even though the shape is
 * mirrored. `UNCOVERED` here is `breakdown.uncovered === true` (zero linked
 * cases anywhere in the subtree, the same boolean plan 10's `CoverageChip`
 * and the gap report both key on), not the milestone's "no completed
 * outcome" -- a requirement whose linked cases are all NOT_RUN is
 * "Untested" here, not "Uncovered". An absent breakdown matches only
 * `"UNCOVERED"`, mirroring the comparator.
 */
export function matchesRequirementCoverageFilter(
  filter: RequirementCoverageFilter,
  breakdown: RequirementCoverageBreakdown | undefined
): boolean {
  if (!filter) return true;
  if (!breakdown) return filter === "UNCOVERED";
  if (filter === "UNCOVERED") return breakdown.uncovered === true;
  if (filter === "UNTESTED") return (breakdown.untested ?? 0) > 0;
  if (filter.startsWith("status:")) {
    const statusId = Number(filter.slice("status:".length));
    return (breakdown.statuses ?? []).some(
      (entry) => entry.statusId === statusId && entry.count > 0
    );
  }
  return true;
}
