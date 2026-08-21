/**
 * Requirement coverage rollup (COV-01/COV-02/COV-03) — computes each
 * requirement's test coverage from the cases linked anywhere in its
 * subtree, classified failed-anywhere-wins over each case's single most
 * recent execution.
 *
 * Vocabulary (`linkedCaseCount`/`passed`/`failed`/`inProgress`/`notRun`/
 * `uncovered`) is adopted verbatim from `lib/services/milestoneMemberCoverage.ts`'s
 * shipped `CoverageBreakdown` shape, dropping the milestone-specific
 * framing, so a later UI can share one coverage-chip renderer across both
 * surfaces. Deliberately NOT carried over: that file's per-status matrix
 * array and its untested counter — those exist to drive a status-by-status
 * breakdown table this phase has no UI for yet; a later phase can add them
 * back onto this same breakdown shape if a matrix view needs them.
 */

export type RequirementCoverageStatus =
  | "UNCOVERED"
  | "FAILED"
  | "NOT_RUN"
  | "PASSED";

export interface RequirementCoverageBreakdown {
  linkedCaseCount: number;
  /**
   * How many of `linkedCaseCount` live in projects other than the
   * requirement's own project. Named independently of the milestone
   * service's `otherProjectCaseCount` because a requirement's "other
   * project" is measured against the requirement's own project, never a
   * milestone's home project.
   */
  crossProjectCaseCount: number;
  passed: number;
  failed: number;
  inProgress: number;
  notRun: number;
  uncovered: boolean;
  status: RequirementCoverageStatus;
}

export interface RequirementCoverageScope {
  /**
   * Projects the viewer may read. `null` means unrestricted (ADMIN). The
   * requirement's own project is NOT part of this shape — the rollup
   * already takes the project as its own argument, and duplicating it
   * here would let the two disagree.
   */
  accessibleProjectIds: number[] | null;
}

/**
 * The four-rung failed-anywhere-wins precedence ladder, evaluated over a
 * requirement's covering-case counts. Pure — no I/O, no db client — so it
 * is unit-testable on its own, independent of the query that produces the
 * counts.
 */
export function classifyRequirementCoverage(
  counts: Omit<RequirementCoverageBreakdown, "status" | "uncovered">
): RequirementCoverageStatus {
  // Rung 1 — structural: no covering cases anywhere in the subtree wins
  // first, regardless of every other counter also being zero.
  if (counts.linkedCaseCount === 0) {
    return "UNCOVERED";
  }
  // Rung 2 — one failure anywhere holds the whole requirement back, even
  // against a majority of passes.
  if (counts.failed > 0) {
    return "FAILED";
  }
  // Rung 3 — every covering case passed. This can never be reached with
  // zero linked cases: rung 1 already returned in that case, so
  // `passed === linkedCaseCount` here always means at least one real pass,
  // not a 0 === 0 coincidence that looks like a bug in review but is not.
  if (counts.passed === counts.linkedCaseCount) {
    return "PASSED";
  }
  // Rung 4 — everything else: in-progress, not-run, or a mix that never
  // failed and never fully passed.
  return "NOT_RUN";
}
