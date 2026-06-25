import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import {
  aggregateStatusCounts,
  groupTestRunContributors,
  mapSessionContributors,
  milestoneStatusLabel,
  shapeReviewDecisions,
  type MilestoneExportData,
} from "~/lib/services/milestoneExport";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import {
  calculateMilestoneCompletion,
  getMilestoneLinkedIssues,
  getSessionSegments,
  getTestRunSegments,
} from "~/lib/services/milestoneSummary";
import { authOptions } from "~/server/auth";

export type { MilestoneExportData };

/** Walk a milestone's parent chain to build a root-first path of names. */
async function buildParentPath(parentId: number | null): Promise<string[]> {
  const path: string[] = [];
  let current = parentId;
  // Bound the walk defensively against unexpected cycles.
  for (let i = 0; i < 25 && current != null; i++) {
    const parent = await baseDb.milestones.findUnique({
      where: { id: current },
      select: { name: true, parentId: true },
    });
    if (!parent) break;
    path.unshift(parent.name);
    current = parent.parentId;
  }
  return path;
}

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

    const milestone = await baseDb.milestones.findUnique({
      where: { id: milestoneId, isDeleted: false },
      select: {
        id: true,
        name: true,
        projectId: true,
        isStarted: true,
        isCompleted: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        parentId: true,
        creator: { select: { name: true } },
        milestoneType: { select: { name: true } },
      },
    });

    if (!milestone) {
      return NextResponse.json(
        { error: "Milestone not found" },
        { status: 404 }
      );
    }

    // Roll up across this milestone and all descendants.
    const descendantIds = await getAllDescendantMilestoneIds(milestoneId);
    const allMilestoneIds = [milestoneId, ...descendantIds];

    const [testRunSegments, sessionSegments, completionRate, parentPath] =
      await Promise.all([
        getTestRunSegments(allMilestoneIds),
        getSessionSegments(allMilestoneIds),
        calculateMilestoneCompletion(allMilestoneIds),
        buildParentPath(milestone.parentId),
      ]);

    const allSegments = [...testRunSegments, ...sessionSegments];
    const totalElapsed = allSegments.reduce(
      (s, seg) => s + (seg.elapsed || 0),
      0
    );
    const totalEstimate = allSegments.reduce(
      (s, seg) => s + (seg.estimate || 0),
      0
    );

    const rollupCounts = aggregateStatusCounts(allSegments);
    const testRuns = groupTestRunContributors(testRunSegments);
    const sessions = mapSessionContributors(sessionSegments);

    const testRunIds = testRuns.map((r) => r.id);
    const sessionIds = sessions.map((s) => s.id);

    // Descendant sub-milestone metadata for the nesting table.
    const descendants =
      descendantIds.length > 0
        ? (
            await baseDb.milestones.findMany({
              where: { id: { in: descendantIds }, isDeleted: false },
              select: {
                id: true,
                name: true,
                isStarted: true,
                isCompleted: true,
              },
              orderBy: { name: "asc" },
            })
          ).map((d) => ({
            id: d.id,
            name: d.name,
            status: milestoneStatusLabel(d),
          }))
        : [];

    const linkedIssues = await getMilestoneLinkedIssues(
      testRunIds,
      sessionIds,
      milestone.projectId
    );
    const issues = linkedIssues.map((issue) => ({
      key: issue.externalKey || issue.externalId || issue.name,
      title: issue.title || issue.name,
      status: issue.externalStatus,
    }));

    // Review & Approval decisions for the contributing runs and sessions.
    const entityNameByKey = new Map<string, string>();
    for (const r of testRuns) entityNameByKey.set(`RUN:${r.id}`, r.name);
    for (const s of sessions) entityNameByKey.set(`SESSION:${s.id}`, s.name);

    const reviewOr: Array<{
      entityType: "RUN" | "SESSION";
      entityId: { in: number[] };
    }> = [];
    if (testRunIds.length > 0)
      reviewOr.push({ entityType: "RUN", entityId: { in: testRunIds } });
    if (sessionIds.length > 0)
      reviewOr.push({ entityType: "SESSION", entityId: { in: sessionIds } });

    const reviewRequests =
      reviewOr.length > 0
        ? await baseDb.reviewRequest.findMany({
            where: {
              projectId: milestone.projectId,
              isDeleted: false,
              OR: reviewOr,
            },
            select: {
              entityType: true,
              entityId: true,
              status: true,
              decidedAt: true,
              decisionComment: true,
              decidedBy: { select: { name: true } },
            },
            orderBy: { createdAt: "desc" },
          })
        : [];
    const reviewDecisions = shapeReviewDecisions(
      reviewRequests,
      entityNameByKey
    );

    const response: MilestoneExportData = {
      milestone: {
        id: milestone.id,
        name: milestone.name,
        status: milestoneStatusLabel(milestone),
        startedAt: milestone.startedAt?.toISOString() ?? null,
        completedAt: milestone.completedAt?.toISOString() ?? null,
        createdAt: milestone.createdAt.toISOString(),
        ownerName: milestone.creator?.name ?? null,
        typeName: milestone.milestoneType?.name ?? null,
        parentPath,
      },
      rollup: {
        totalItems: rollupCounts.totalItems,
        executedItems: rollupCounts.executedItems,
        completionRate,
        totalElapsed,
        totalEstimate,
        statusCounts: rollupCounts.statusCounts,
      },
      testRuns,
      sessions,
      descendants,
      issues,
      reviewDecisions,
      generatedAt: new Date().toISOString(),
      projectId: milestone.projectId,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Milestone export error:", error);
    return NextResponse.json(
      { error: "Failed to build milestone export" },
      { status: 500 }
    );
  }
}
