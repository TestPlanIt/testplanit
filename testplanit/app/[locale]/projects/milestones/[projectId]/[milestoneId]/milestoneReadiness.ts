import type {
  CoverageBreakdown,
  MemberCoverageResponse,
} from "~/app/api/milestones/[milestoneId]/members/coverage/route";

/**
 * Release-readiness rollup for a synced/local milestone (fast-follow READY,
 * D4). A thin aggregation over the per-issue coverage the Issues section
 * already fetches (`members/coverage`) — no new query.
 *
 * Each member issue rolls up to ONE readiness state via a worst-wins order
 * (failed > in-progress > not-run > passed), with "uncovered" (no linked
 * cases) kept distinct per D-05 — consistent with `hasCompletedCoverage` in
 * CoverageChip: an issue only reads "passed" when every linked case passed.
 */
export type IssueReadinessState =
  "passed" | "failed" | "inProgress" | "notRun" | "uncovered";

export function rollupIssueReadiness(
  breakdown: CoverageBreakdown | undefined
): IssueReadinessState {
  // No linked cases at all → a distinct gap state, never folded into notRun.
  if (!breakdown || breakdown.uncovered || breakdown.linkedCaseCount === 0) {
    return "uncovered";
  }
  if (breakdown.failed > 0) return "failed";
  if (breakdown.inProgress > 0) return "inProgress";
  // Any case still lacking a completed in-scope result keeps the issue out of
  // "ready" (notRun already folds in the untested cases).
  if (breakdown.notRun > 0) return "notRun";
  return "passed";
}

export interface MilestoneReadiness {
  total: number;
  passed: number;
  failed: number;
  inProgress: number;
  notRun: number;
  uncovered: number;
  /**
   * Percent of member issues that are fully passing (0–100, rounded). Uncovered
   * and not-run issues count against readiness by design — they represent
   * unverified scope, which is exactly what "% ready" must surface. 0 when the
   * milestone has no member issues.
   */
  percentReady: number;
}

export function aggregateMilestoneReadiness(
  coverage: MemberCoverageResponse | undefined,
  memberIssueIds: number[]
): MilestoneReadiness {
  const readiness: MilestoneReadiness = {
    total: 0,
    passed: 0,
    failed: 0,
    inProgress: 0,
    notRun: 0,
    uncovered: 0,
    percentReady: 0,
  };
  for (const issueId of memberIssueIds) {
    readiness.total += 1;
    readiness[rollupIssueReadiness(coverage?.[issueId])] += 1;
  }
  readiness.percentReady =
    readiness.total === 0
      ? 0
      : Math.round((readiness.passed / readiness.total) * 100);
  return readiness;
}
