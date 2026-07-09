import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
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
 * projectId is always re-derived server-side from the milestone row; a
 * client-supplied projectId is never trusted (T-18-05-01/V13). Access is
 * gated the same way the sibling milestone routes (summary/, forecast/,
 * descendants/) are: authenticated session + the milestone row existing.
 * `baseDb` is the raw ZenStack client (no per-row access policy) — this
 * matches the existing milestone-detail read surface, which is reached only
 * through UI already scoped to projects the session can see.
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
    // Resolve the milestone row server-side — projectId is NEVER trusted
    // from client input (V13 / T-18-05-01).
    const milestone = await baseDb.milestones.findUnique({
      where: { id: milestoneId },
      select: { id: true, projectId: true },
    });

    if (!milestone) {
      return NextResponse.json(
        { error: "Milestone not found" },
        { status: 404 }
      );
    }

    const response = await getMemberCoverage(milestoneId);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Milestone member coverage error:", error);
    return NextResponse.json(
      { error: "Failed to fetch member coverage" },
      { status: 500 }
    );
  }
}
