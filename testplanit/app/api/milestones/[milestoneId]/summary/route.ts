import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";

const prisma = new PrismaClient();

export type MilestoneSummaryData = {
  milestoneId: number;
  totalItems: number;
  completionRate: number;
  totalElapsed: number;
  totalEstimate: number;
  segments: Array<{
    id: string;
    type: "test-run" | "session";
    sourceId: number;
    sourceName: string;
    statusId: number | null;
    statusName: string;
    colorValue: string;
    elapsed: number | null;
    estimate: number | null;
    isPending: boolean;
    itemCount?: number; // For test runs, number of cases
  }>;
  issues: Array<{
    id: number;
    name: string;
    title: string;
    externalId: string | null;
    externalKey: string | null;
    externalUrl: string | null;
    externalStatus: string | null;
    data: any;
    integrationId: number | null;
    lastSyncedAt: Date | null;
    integration: {
      id: number;
      provider: string;
      name: string;
    } | null;
    projectIds: number[];
  }>;
};

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
    const milestone = await prisma.milestones.findUnique({
      where: { id: milestoneId },
      select: { id: true, projectId: true },
    });

    if (!milestone) {
      return NextResponse.json(
        { error: "Milestone not found" },
        { status: 404 }
      );
    }

    // Get test run segments
    const testRunSegments = await getTestRunSegments(milestoneId);

    // Get session segments
    const sessionSegments = await getSessionSegments(milestoneId);

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
    const completionRate = await calculateMilestoneCompletion(milestoneId);

    // Get all unique issues from test runs and sessions
    const issueIds = new Set<number>();
    const testRunIds = testRunSegments.map((seg) => seg.sourceId);
    const sessionIds = sessionSegments.map((seg) => seg.sourceId);

    // Fetch test run issues
    const testRunIssues =
      testRunIds.length > 0
        ? await prisma.$queryRaw<
            Array<{
              issueId: number;
            }>
          >`
        SELECT DISTINCT "B" as "issueId"
        FROM "_IssueToTestRuns"
        WHERE "A" = ANY(${testRunIds}::int[])
      `
        : [];

    testRunIssues.forEach((link) => issueIds.add(link.issueId));

    // Fetch session issues (session-level)
    const sessionIssues =
      sessionIds.length > 0
        ? await prisma.$queryRaw<
            Array<{
              issueId: number;
            }>
          >`
        SELECT DISTINCT "B" as "issueId"
        FROM "_IssueToSessions"
        WHERE "A" = ANY(${sessionIds}::int[])
      `
        : [];

    sessionIssues.forEach((link) => issueIds.add(link.issueId));

    // Fetch session result issues
    const sessionResultIssues =
      sessionIds.length > 0
        ? await prisma.$queryRaw<
            Array<{
              issueId: number;
            }>
          >`
        SELECT DISTINCT irs."B" as "issueId"
        FROM "_IssueToSessionResults" irs
        JOIN "SessionResults" sr ON irs."A" = sr.id
        WHERE sr."sessionId" = ANY(${sessionIds}::int[])
          AND sr."isDeleted" = false
      `
        : [];

    sessionResultIssues.forEach((link) => issueIds.add(link.issueId));

    // Fetch all unique issues
    const issues =
      issueIds.size > 0
        ? await prisma.issue.findMany({
            where: {
              id: { in: Array.from(issueIds) },
            },
            select: {
              id: true,
              name: true,
              title: true,
              externalId: true,
              externalKey: true,
              externalUrl: true,
              externalStatus: true,
              data: true,
              integrationId: true,
              lastSyncedAt: true,
              integration: {
                select: {
                  id: true,
                  provider: true,
                  name: true,
                },
              },
            },
          })
        : [];

    const response: MilestoneSummaryData = {
      milestoneId,
      totalItems,
      completionRate,
      totalElapsed,
      totalEstimate,
      segments: allSegments,
      issues: issues.map((issue) => ({
        ...issue,
        projectIds: [milestone.projectId],
      })),
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

async function calculateMilestoneCompletion(
  milestoneId: number
): Promise<number> {
  // Get total test cases in all test runs for this milestone
  const totalCasesResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "TestRunCases" trc
    JOIN "TestRuns" tr ON trc."testRunId" = tr.id
    WHERE tr."milestoneId" = ${milestoneId}
      AND tr."isDeleted" = false
  `;
  const totalTestCases = Number(totalCasesResult[0]?.count || 0);

  if (totalTestCases === 0) {
    return 0;
  }

  // Get count of completed test cases (where TestRunCases.status.isCompleted = true)
  const completedCasesResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "TestRunCases" trc
    JOIN "TestRuns" tr ON trc."testRunId" = tr.id
    JOIN "Status" s ON trc."statusId" = s.id
    WHERE tr."milestoneId" = ${milestoneId}
      AND tr."isDeleted" = false
      AND s."isCompleted" = true
  `;
  const completedTestCases = Number(completedCasesResult[0]?.count || 0);

  // Calculate percentage, capped at 100%
  return Math.min((completedTestCases / totalTestCases) * 100, 100);
}

async function getTestRunSegments(
  milestoneId: number
): Promise<MilestoneSummaryData["segments"]> {
  // Get test runs for this milestone with aggregated case data
  const testRuns = await prisma.$queryRaw<
    Array<{
      testRunId: number;
      testRunName: string;
      testRunType: string;
      totalCases: bigint;
      totalElapsed: number | null;
      totalEstimate: number | null;
      hasPendingCases: boolean;
      statusId: number | null;
      statusName: string | null;
      colorValue: string | null;
      statusCaseCount: bigint;
    }>
  >`
    WITH test_run_data AS (
      SELECT
        tr.id as "testRunId",
        tr.name as "testRunName",
        tr."testRunType",
        trc."statusId",
        s.name as "statusName",
        COALESCE(c.value, '#9ca3af') as "colorValue",
        COUNT(trc.id) as "statusCaseCount",
        SUM(
          COALESCE(trr.elapsed, 0) +
          COALESCE((
            SELECT SUM(COALESCE(trsr.elapsed, 0))
            FROM "TestRunStepResults" trsr
            WHERE trsr."testRunResultId" = trr.id
          ), 0)
        ) as "caseElapsed",
        BOOL_OR(trr.id IS NULL) as "hasPendingCases",
        SUM(CASE WHEN trr.id IS NULL THEN COALESCE(rc.estimate, 0) ELSE 0 END) as "caseEstimate"
      FROM "TestRuns" tr
      JOIN "TestRunCases" trc ON trc."testRunId" = tr.id
      JOIN "RepositoryCases" rc ON trc."repositoryCaseId" = rc.id
      LEFT JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
      LEFT JOIN "Status" s ON trc."statusId" = s.id
      LEFT JOIN "Color" c ON s."colorId" = c.id
      WHERE tr."milestoneId" = ${milestoneId}
        AND tr."isDeleted" = false
      GROUP BY tr.id, tr.name, tr."testRunType", trc."statusId", s.name, c.value
    )
    SELECT
      "testRunId",
      "testRunName",
      "testRunType",
      COUNT(*) as "totalCases",
      SUM("caseElapsed") as "totalElapsed",
      SUM("caseEstimate") as "totalEstimate",
      BOOL_OR("hasPendingCases") as "hasPendingCases",
      "statusId",
      COALESCE("statusName", 'Untested') as "statusName",
      "colorValue",
      SUM("statusCaseCount") as "statusCaseCount"
    FROM test_run_data
    GROUP BY "testRunId", "testRunName", "testRunType", "statusId", "statusName", "colorValue"
    ORDER BY "testRunId", "statusId" ASC NULLS LAST
  `;

  // Group test run cases by test run and status
  const segments: MilestoneSummaryData["segments"] = [];
  const testRunMap = new Map<
    number,
    {
      name: string;
      type: string;
      cases: Array<{
        statusId: number | null;
        statusName: string;
        colorValue: string;
        count: number;
        elapsed: number;
        estimate: number;
        hasPending: boolean;
      }>;
    }
  >();

  testRuns.forEach((run) => {
    if (!testRunMap.has(run.testRunId)) {
      testRunMap.set(run.testRunId, {
        name: run.testRunName,
        type: run.testRunType,
        cases: [],
      });
    }
    const testRunData = testRunMap.get(run.testRunId)!;
    testRunData.cases.push({
      statusId: run.statusId,
      statusName: run.statusName || "Untested",
      colorValue: run.colorValue || "#9ca3af",
      count: Number(run.statusCaseCount),
      elapsed: Number(run.totalElapsed || 0),
      estimate: Number(run.totalEstimate || 0),
      hasPending: run.hasPendingCases,
    });
  });

  // Create segments for each test run case status
  testRunMap.forEach((runData, testRunId) => {
    runData.cases.forEach((caseData, index) => {
      segments.push({
        id: `test-run-${testRunId}-${caseData.statusId ?? "null"}-${index}`,
        type: "test-run",
        sourceId: testRunId,
        sourceName: runData.name,
        statusId: caseData.statusId,
        statusName: caseData.statusName,
        colorValue: caseData.colorValue,
        elapsed: caseData.elapsed,
        estimate: caseData.estimate,
        isPending: caseData.hasPending,
        itemCount: caseData.count,
      });
    });
  });

  return segments;
}

async function getSessionSegments(
  milestoneId: number
): Promise<MilestoneSummaryData["segments"]> {
  // Get sessions for this milestone with their latest results
  const sessions = await prisma.$queryRaw<
    Array<{
      sessionId: number;
      sessionName: string;
      sessionEstimate: number | null;
      resultId: number | null;
      resultCreatedAt: Date | null;
      resultElapsed: number | null;
      statusId: number | null;
      statusName: string | null;
      colorValue: string | null;
    }>
  >`
    SELECT
      s.id as "sessionId",
      s.name as "sessionName",
      s.estimate as "sessionEstimate",
      sr.id as "resultId",
      sr."createdAt" as "resultCreatedAt",
      sr.elapsed as "resultElapsed",
      sr."statusId",
      st.name as "statusName",
      COALESCE(c.value, '#9ca3af') as "colorValue"
    FROM "Sessions" s
    LEFT JOIN LATERAL (
      SELECT
        sr2.id,
        sr2."createdAt",
        sr2.elapsed,
        sr2."statusId"
      FROM "SessionResults" sr2
      WHERE sr2."sessionId" = s.id
        AND sr2."isDeleted" = false
      ORDER BY sr2."createdAt" DESC
      LIMIT 1
    ) sr ON true
    LEFT JOIN "Status" st ON sr."statusId" = st.id
    LEFT JOIN "Color" c ON st."colorId" = c.id
    WHERE s."milestoneId" = ${milestoneId}
      AND s."isDeleted" = false
    ORDER BY s.id
  `;

  return sessions.map((session) => {
    const hasPending = session.resultId === null;
    const firstStatus = session.statusName || "Untested";
    const firstColor = session.colorValue || "#9ca3af";

    return {
      id: `session-${session.sessionId}`,
      type: "session" as const,
      sourceId: session.sessionId,
      sourceName: session.sessionName,
      statusId: session.statusId,
      statusName: firstStatus,
      colorValue: firstColor,
      elapsed: session.resultElapsed,
      estimate: hasPending ? session.sessionEstimate : null,
      isPending: hasPending,
      itemCount: 1,
    };
  });
}
