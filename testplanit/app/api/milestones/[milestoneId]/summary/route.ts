import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import {
  calculateMilestoneCompletion,
  getMilestoneLinkedIssues,
  getSessionSegments,
  getTestRunSegments,
  type MilestoneSummaryData,
} from "~/lib/services/milestoneSummary";
import { authOptions } from "~/server/auth";

export type { MilestoneSummaryData };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ milestoneId: string }> }
) {
  const { milestoneId: milestoneIdParam } = await params;
  const milestoneId = Number(milestoneIdParam);

  if (isNaN(milestoneId)) {
    return NextResponse.json(
      { error: "Invalid milestone ID" },
      { status: 400 }
    );
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify milestone exists and get project ID
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

    // Get all descendant milestone IDs for rollup
    const descendantIds = await getAllDescendantMilestoneIds(milestoneId);
    const allMilestoneIds = [milestoneId, ...descendantIds];

    // Get test run segments (including descendants)
    const testRunSegments = await getTestRunSegments(allMilestoneIds);

    // Get session segments (including descendants)
    const sessionSegments = await getSessionSegments(allMilestoneIds);

    // Combine segments
    const allSegments = [...testRunSegments, ...sessionSegments];

    // Calculate totals
    const totalItems =
      testRunSegments.reduce((sum, seg) => sum + (seg.itemCount || 1), 0) +
      sessionSegments.length;
    const totalElapsed = allSegments.reduce(
      (sum, seg) => sum + (seg.elapsed || 0),
      0
    );
    const totalEstimate = allSegments.reduce(
      (sum, seg) => sum + (seg.estimate || 0),
      0
    );

    // Calculate completion rate for test runs
    // (# of test results with isCompleted=true) / (# of total test cases in test runs) × 100
    const completionRate = await calculateMilestoneCompletion(allMilestoneIds);

    // Get comment count for this milestone
    const commentsCount = await baseDb.comment.count({
      where: {
        milestoneId,
        isDeleted: false,
      },
    });

    // Get all unique issues from test runs and sessions
    const testRunIds = testRunSegments.map((seg) => seg.sourceId);
    const sessionIds = sessionSegments.map((seg) => seg.sourceId);
    const issues = await getMilestoneLinkedIssues(
      testRunIds,
      sessionIds,
      milestone.projectId
    );

    const response: MilestoneSummaryData = {
      milestoneId,
      totalItems,
      completionRate,
      totalElapsed,
      totalEstimate,
      commentsCount,
      segments: allSegments,
      issues,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Milestone summary error:", error);
    return NextResponse.json(
      { error: "Failed to fetch milestone summary" },
      { status: 500 }
    );
  }
}
