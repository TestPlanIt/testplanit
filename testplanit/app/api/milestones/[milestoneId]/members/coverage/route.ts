import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { getVisibleMilestone } from "~/lib/services/milestoneAccess";
import { getMemberCoverage } from "~/lib/services/milestoneMemberCoverage";
import { authOptions } from "~/server/auth";

/**
 * GET /api/milestones/[milestoneId]/members/coverage
 *
 * Per-member-issue coverage breakdown for a synced or local milestone's
 * Issues section (MLINK-04, D-04/D-05/D-06/D-15). Turns the 18-01 RED
 * scaffold GREEN.
 *
 * Shape: `Record<issueId, CoverageBreakdown>` where each entry is
 * `{ linkedCaseCount, passed, failed, inProgress, notRun, uncovered }`.
 *
 * Classification follows the NAMED convention in
 * lib/services/testRunSummary.ts (Status.isSuccess/isFailure/isCompleted):
 *   passed     = latest in-scope result's Status.isSuccess === true
 *   failed     = latest in-scope result's Status.isFailure === true
 *   inProgress = latest in-scope result exists, Status.isCompleted === true,
 *                and neither isSuccess nor isFailure
 *   notRun     = case is linked but has no in-scope result (or the latest
 *                in-scope result's Status.isCompleted !== true)
 *   uncovered  = the issue has zero linked RepositoryCases — a distinct 5th
 *                state (D-05), never folded into notRun.
 *
 * Result scope (runs/sessions via TestRunCases) is descendant-inclusive
 * (D-06: this milestone + getAllDescendantMilestoneIds). Membership itself
 * (which issues count as "members" at all) is NOT descendant-scoped (D-15)
 * — only `MilestoneIssue` rows on the requested milestone qualify.
 *
 * Cross-project blend: linked cases in OTHER projects count toward the
 * breakdown (and toward `otherProjectCaseCount`), classified by their
 * latest result from any non-deleted run in their own project. The bleed is
 * viewer-scoped — `resolveViewerProjectScope` limits it to projects this
 * session can read, so per-viewer totals never reveal inaccessible projects.
 *
 * projectId is always re-derived server-side from the milestone row; a
 * client-supplied projectId is never trusted (T-18-05-01/V13). Access is
 * gated by the policy-scoped visibility check (getVisibleMilestone): the
 * enhanced client's project-scoped Milestones read ACL must return the row
 * or the route responds 404.
 */
export type {
  CoverageBreakdown,
  CoverageStatusCount,
  MemberCoverageResponse,
} from "~/lib/services/milestoneMemberCoverage";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ milestoneId: string }> }
) {
  const { milestoneId: milestoneIdParam } = await context.params;
  const milestoneId = Number(milestoneIdParam);

  if (isNaN(milestoneId)) {
    return NextResponse.json(
      { error: "Invalid milestone ID" },
      { status: 400 }
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Policy-scoped visibility gate (T-18-01-02/T-18-05-01): the enhanced
    // client's project-scoped read ACL decides access; unauthorized users
    // get the same 404 as a missing milestone.
    const milestone = await getVisibleMilestone(session, milestoneId);
    if (!milestone) {
      return NextResponse.json(
        { error: "Milestone not found" },
        { status: 404 }
      );
    }

    const accessibleProjectIds = await resolveViewerProjectScope(
      session.user.id
    );
    const response = await getMemberCoverage(milestoneId, {
      projectId: milestone.projectId,
      accessibleProjectIds,
    });
    return NextResponse.json(response);
  } catch (error) {
    console.error("Milestone member coverage error:", error);
    return NextResponse.json(
      { error: "Failed to fetch member coverage" },
      { status: 500 }
    );
  }
}
