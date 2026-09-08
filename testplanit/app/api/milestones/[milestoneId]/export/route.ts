import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
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
import { getMemberCoverage } from "~/lib/services/milestoneMemberCoverage";
import {
  calculateMilestoneCompletion,
  getMilestoneLinkedIssues,
  getSessionSegments,
  getTestRunSegments,
} from "~/lib/services/milestoneSummary";
import { getVisibleMilestone } from "~/lib/services/milestoneAccess";
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

    // Policy-scoped visibility gate first; detail fields are then fetched
    // via baseDb — visibility is already decided.
    const visible = await getVisibleMilestone(session, milestoneId);
    if (!visible) {
      return NextResponse.json(
        { error: "Milestone not found" },
        { status: 404 }
      );
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
        // Decides whether the dates are calendar dates or instants; sprints
        // are the latter. See `hasCalendarDates` in `~/utils/milestoneUtils`.
        externalKind: true,
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

    // Member Issues panel (MLINK-04): the milestone's MilestoneIssue rows
    // with the same per-status coverage the Issues section displays.
    const UNTESTED_COLOR = "#9ca3af";
    const memberRows = await baseDb.milestoneIssue.findMany({
      where: { milestoneId },
      include: {
        issue: {
          select: {
            id: true,
            name: true,
            title: true,
            externalKey: true,
            externalStatus: true,
            status: true,
          },
        },
      },
    });
    const memberCoverage =
      memberRows.length > 0
        ? await getMemberCoverage(milestoneId, {
            projectId: visible.projectId,
            accessibleProjectIds: await resolveViewerProjectScope(
              session.user.id
            ),
          })
        : {};

    const memberIssues = memberRows
      .map((row) => {
        const breakdown = memberCoverage[row.issueId];
        const coverageStatuses = (breakdown?.statuses ?? []).map((entry) => ({
          statusName: entry.name,
          count: entry.count,
          colorValue: entry.color ?? UNTESTED_COLOR,
        }));
        return {
          key: row.issue?.externalKey || row.issue?.name || String(row.issueId),
          title: row.issue?.title || row.issue?.name || "",
          status: row.issue?.externalStatus ?? row.issue?.status ?? null,
          source: row.source as "SYNCED" | "MANUAL",
          coverageStatuses,
          untested: breakdown?.untested ?? 0,
          // Same rule as the UI: uncovered = no completed outcome in scope.
          uncovered: !breakdown || coverageStatuses.length === 0,
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));

    const memberTotalsByStatus = new Map<
      string,
      { statusName: string; count: number; colorValue: string }
    >();
    let memberUntestedTotal = 0;
    let memberUncoveredIssues = 0;
    for (const member of memberIssues) {
      memberUntestedTotal += member.untested;
      if (member.uncovered) memberUncoveredIssues += 1;
      for (const entry of member.coverageStatuses) {
        const existing = memberTotalsByStatus.get(entry.statusName);
        if (existing) {
          existing.count += entry.count;
        } else {
          memberTotalsByStatus.set(entry.statusName, { ...entry });
        }
      }
    }
    const memberCoverageTotals = {
      statuses: Array.from(memberTotalsByStatus.values()).sort(
        (a, b) => b.count - a.count
      ),
      untested: memberUntestedTotal,
      uncoveredIssues: memberUncoveredIssues,
    };

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

    // Per-case traceability matrix (READY, D4): each member issue × its linked
    // cases × that case's latest in-scope result. Uncovered issues appear once
    // with a null case (a coverage gap); a linked case with no in-scope result
    // is left null ("Not run"). Same descendant-inclusive result scope as
    // coverage; mirrors that query's linked_cases/latest_result CTEs.
    //
    // Automated (JUnit/TestNG/Mocha/etc.) runs never denormalise a status onto
    // TestRunCases.statusId — their outcome lives in JUnitTestResult — so a
    // status-less run-case is skipped in latest_result and the case falls back
    // to latest_junit. Without that, an automated-only case reported blank,
    // indistinguishable from "Not run", despite having real results.
    //
    // latest_result reads the "EffectiveCaseStatus" view; RUN_CASE-sourced
    // rows are exactly the status-carrying live run-cases. latest_junit stays
    // hand-rolled because it resolves at a different grain than the view: the
    // latest non-'untested' automated result per CASE across every in-scope
    // run, including results whose case was never added to the run's
    // composition.
    const traceabilityRaw =
      memberRows.length > 0
        ? await baseDb.$queryRaw<
            Array<{
              externalKey: string | null;
              title: string | null;
              issueName: string | null;
              caseName: string | null;
              statusName: string | null;
              statusColor: string | null;
              runName: string | null;
              completedAt: Date | null;
              hasResult: boolean | null;
            }>
          >`
            WITH member_issues AS (
              SELECT mi."issueId", i."externalKey", i.title, i.name AS "issueName"
              FROM "MilestoneIssue" mi
              JOIN "Issue" i ON i.id = mi."issueId"
              WHERE mi."milestoneId" = ${milestoneId}
            ),
            linked_cases AS (
              SELECT rci."issueId", rci."caseId", rc.name AS "caseName"
              FROM "RepositoryCaseIssue" rci
              JOIN "RepositoryCases" rc
                ON rc.id = rci."caseId" AND rc."isDeleted" = false
              WHERE rci."issueId" IN (SELECT "issueId" FROM member_issues)
            ),
            latest_result AS (
              SELECT DISTINCT ON (lc."issueId", lc."caseId")
                lc."issueId",
                lc."caseId",
                ecs."testRunCaseId",
                s.name AS "statusName",
                col.value AS "statusColor",
                tr.name AS "runName",
                ecs."executedAt" AS "completedAt"
              FROM linked_cases lc
              JOIN "EffectiveCaseStatus" ecs
                ON ecs."repositoryCaseId" = lc."caseId"
                AND ecs."statusSource" = 'RUN_CASE'
                AND ecs."milestoneId" = ANY(${allMilestoneIds}::int[])
              JOIN "TestRuns" tr ON tr.id = ecs."testRunId"
              JOIN "Status" s ON s.id = ecs."statusId"
              LEFT JOIN "Color" col ON col.id = s."colorId"
              ORDER BY lc."issueId", lc."caseId", ecs."executedAt" DESC NULLS LAST, ecs."testRunCaseId" DESC
            ),
            latest_junit AS (
              SELECT DISTINCT ON (lc."issueId", lc."caseId")
                lc."issueId",
                lc."caseId",
                s.name AS "statusName",
                col.value AS "statusColor",
                tr.name AS "runName",
                jr."executedAt" AS "completedAt"
              FROM linked_cases lc
              JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = lc."caseId"
              JOIN "JUnitTestSuite" js ON js.id = jr."testSuiteId"
              JOIN "TestRuns" tr
                ON tr.id = js."testRunId"
                AND tr."isDeleted" = false
                AND tr."milestoneId" = ANY(${allMilestoneIds}::int[])
              JOIN "Status" s
                ON s.id = jr."statusId"
                AND s."systemName" IS DISTINCT FROM 'untested'
              LEFT JOIN "Color" col ON col.id = s."colorId"
              ORDER BY lc."issueId", lc."caseId", jr."executedAt" DESC NULLS LAST, jr.id DESC
            ),
            effective AS (
              SELECT
                lc."issueId",
                lc."caseId",
                (lr."testRunCaseId" IS NOT NULL OR lj."caseId" IS NOT NULL)
                  AS "hasResult",
                COALESCE(lr."statusName", lj."statusName") AS "statusName",
                COALESCE(lr."statusColor", lj."statusColor") AS "statusColor",
                COALESCE(lr."runName", lj."runName") AS "runName",
                COALESCE(lr."completedAt", lj."completedAt") AS "completedAt"
              FROM linked_cases lc
              LEFT JOIN latest_result lr
                ON lr."issueId" = lc."issueId" AND lr."caseId" = lc."caseId"
              LEFT JOIN latest_junit lj
                ON lj."issueId" = lc."issueId" AND lj."caseId" = lc."caseId"
            )
            SELECT
              mi."externalKey", mi.title, mi."issueName",
              lc."caseName",
              e."statusName", e."statusColor", e."runName",
              e."completedAt", e."hasResult"
            FROM member_issues mi
            LEFT JOIN linked_cases lc ON lc."issueId" = mi."issueId"
            LEFT JOIN effective e
              ON e."issueId" = lc."issueId" AND e."caseId" = lc."caseId"
            ORDER BY mi."externalKey" NULLS LAST, mi."issueName", lc."caseName" NULLS FIRST
          `
        : [];
    const traceability = traceabilityRaw.map((r) => ({
      issueKey: r.externalKey || r.issueName || "",
      issueTitle: r.title || r.issueName || "",
      caseName: r.caseName ?? null,
      // A row with a linked case but no in-scope result at all = "Not run".
      statusName:
        r.caseName != null && r.hasResult ? (r.statusName ?? null) : null,
      statusColor: r.statusColor ?? null,
      runName: r.runName ?? null,
      executedAt: r.completedAt ? r.completedAt.toISOString() : null,
    }));

    const response: MilestoneExportData = {
      milestone: {
        id: milestone.id,
        name: milestone.name,
        status: milestoneStatusLabel(milestone),
        startedAt: milestone.startedAt?.toISOString() ?? null,
        completedAt: milestone.completedAt?.toISOString() ?? null,
        createdAt: milestone.createdAt.toISOString(),
        externalKind: milestone.externalKind ?? null,
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
      memberIssues,
      memberCoverageTotals,
      traceability,
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
