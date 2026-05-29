import { prisma } from "~/lib/prisma";
import { AUTOMATED_TEST_RUN_TYPES } from "~/utils/testResultTypes";

export type MilestoneSegment = {
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
  statusOrder: number | null;
};

export type MilestoneIssue = {
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
};

export type MilestoneSummaryData = {
  milestoneId: number;
  totalItems: number;
  completionRate: number;
  totalElapsed: number;
  totalEstimate: number;
  commentsCount: number;
  segments: MilestoneSegment[];
  issues: MilestoneIssue[];
};

export async function calculateMilestoneCompletion(
  milestoneIds: number[]
): Promise<number> {
  // Get total test cases in all test runs for these milestones
  const totalCasesResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "TestRunCases" trc
    JOIN "TestRuns" tr ON trc."testRunId" = tr.id
    WHERE tr."milestoneId" = ANY(${milestoneIds}::int[])
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
    WHERE tr."milestoneId" = ANY(${milestoneIds}::int[])
      AND tr."isDeleted" = false
      AND s."isCompleted" = true
  `;
  const completedTestCases = Number(completedCasesResult[0]?.count || 0);

  // Calculate percentage, capped at 100%
  return Math.min((completedTestCases / totalTestCases) * 100, 100);
}

export async function getTestRunSegments(
  milestoneIds: number[]
): Promise<MilestoneSegment[]> {
  // Split the milestone's runs into manual vs. automated. Automated/imported
  // runs (JUnit, TestNG, etc.) record their outcomes in JUnitTestResult, not
  // TestRunResults, so they need a separate aggregation path — otherwise every
  // automated case looks "pending" with zero elapsed.
  const runs = await prisma.$queryRaw<
    Array<{ id: number; testRunType: string }>
  >`
    SELECT id, "testRunType"
    FROM "TestRuns"
    WHERE "milestoneId" = ANY(${milestoneIds}::int[])
      AND "isDeleted" = false
  `;
  const automatedTypes = new Set<string>(AUTOMATED_TEST_RUN_TYPES);
  const regularRunIds = runs
    .filter((r) => !automatedTypes.has(r.testRunType))
    .map((r) => r.id);
  const automatedRunIds = runs
    .filter((r) => automatedTypes.has(r.testRunType))
    .map((r) => r.id);

  const [manual, automated] = await Promise.all([
    getManualTestRunSegments(regularRunIds),
    getAutomatedTestRunSegments(automatedRunIds),
  ]);
  return [...manual, ...automated];
}

async function getManualTestRunSegments(
  runIds: number[]
): Promise<MilestoneSegment[]> {
  if (runIds.length === 0) return [];

  // Get test runs with aggregated case data (manual runs only)
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
      statusOrder: number | null;
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
        s.order as "statusOrder",
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
      WHERE tr.id = ANY(${runIds}::int[])
        AND tr."isDeleted" = false
      GROUP BY tr.id, tr.name, tr."testRunType", trc."statusId", s.name, c.value, s.order
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
      "statusOrder",
      SUM("statusCaseCount") as "statusCaseCount"
    FROM test_run_data
    GROUP BY "testRunId", "testRunName", "testRunType", "statusId", "statusName", "colorValue", "statusOrder"
    ORDER BY "testRunId", "statusId" ASC NULLS LAST
  `;

  // Group test run cases by test run and status
  const segments: MilestoneSegment[] = [];
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
        statusOrder: number | null;
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
      statusOrder: run.statusOrder,
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
        statusOrder: caseData.statusOrder,
      });
    });
  });

  return segments;
}

/**
 * Build status segments for automated/imported runs (JUnit, TestNG, etc.).
 * Their outcomes live in JUnitTestResult (with `time`), grouped by status —
 * each result is an executed item, so segments are never pending and their
 * elapsed comes from the summed result time (same unit the run summary uses).
 */
async function getAutomatedTestRunSegments(
  runIds: number[]
): Promise<MilestoneSegment[]> {
  if (runIds.length === 0) return [];

  const rows = await prisma.$queryRaw<
    Array<{
      testRunId: number;
      testRunName: string;
      statusId: number | null;
      statusName: string | null;
      colorValue: string | null;
      statusOrder: number | null;
      resultType: string | null;
      count: bigint;
      elapsed: number | null;
    }>
  >`
    SELECT
      su."testRunId" as "testRunId",
      tr.name as "testRunName",
      jr."statusId" as "statusId",
      s.name as "statusName",
      COALESCE(c.value, '#9ca3af') as "colorValue",
      s.order as "statusOrder",
      jr.type as "resultType",
      COUNT(*) as "count",
      COALESCE(SUM(jr.time), 0) as "elapsed"
    FROM "JUnitTestResult" jr
    JOIN "JUnitTestSuite" su ON jr."testSuiteId" = su.id
    JOIN "TestRuns" tr ON su."testRunId" = tr.id
    LEFT JOIN "Status" s ON jr."statusId" = s.id
    LEFT JOIN "Color" c ON s."colorId" = c.id
    WHERE su."testRunId" = ANY(${runIds}::int[])
    GROUP BY su."testRunId", tr.name, jr."statusId", s.name, c.value, s.order, jr.type
    ORDER BY su."testRunId", jr."statusId" ASC NULLS LAST
  `;

  return rows.map((row, index) => ({
    id: `test-run-junit-${row.testRunId}-${row.statusId ?? row.resultType ?? "null"}-${index}`,
    type: "test-run" as const,
    sourceId: row.testRunId,
    sourceName: row.testRunName,
    statusId: row.statusId,
    statusName: row.statusName || row.resultType || "Untested",
    colorValue: row.colorValue || "#9ca3af",
    elapsed: Number(row.elapsed || 0),
    estimate: null,
    isPending: false,
    itemCount: Number(row.count),
    statusOrder: row.statusOrder,
  }));
}

export async function getSessionSegments(
  milestoneIds: number[]
): Promise<MilestoneSegment[]> {
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
      statusOrder: number | null;
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
      COALESCE(c.value, '#9ca3af') as "colorValue",
      st.order as "statusOrder"
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
    WHERE s."milestoneId" = ANY(${milestoneIds}::int[])
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
      statusOrder: session.statusOrder,
    };
  });
}

/**
 * Collect all unique issues linked to a milestone's test runs and sessions
 * (session-level and session-result-level), returned in the summary shape.
 */
export async function getMilestoneLinkedIssues(
  testRunIds: number[],
  sessionIds: number[],
  projectId: number
): Promise<MilestoneIssue[]> {
  const issueIds = new Set<number>();

  const testRunIssues =
    testRunIds.length > 0
      ? await prisma.$queryRaw<Array<{ issueId: number }>>`
        SELECT DISTINCT "B" as "issueId"
        FROM "_IssueToTestRuns"
        WHERE "A" = ANY(${testRunIds}::int[])
      `
      : [];
  testRunIssues.forEach((link) => issueIds.add(link.issueId));

  const sessionIssues =
    sessionIds.length > 0
      ? await prisma.$queryRaw<Array<{ issueId: number }>>`
        SELECT DISTINCT "B" as "issueId"
        FROM "_IssueToSessions"
        WHERE "A" = ANY(${sessionIds}::int[])
      `
      : [];
  sessionIssues.forEach((link) => issueIds.add(link.issueId));

  const sessionResultIssues =
    sessionIds.length > 0
      ? await prisma.$queryRaw<Array<{ issueId: number }>>`
        SELECT DISTINCT irs."B" as "issueId"
        FROM "_IssueToSessionResults" irs
        JOIN "SessionResults" sr ON irs."A" = sr.id
        WHERE sr."sessionId" = ANY(${sessionIds}::int[])
          AND sr."isDeleted" = false
      `
      : [];
  sessionResultIssues.forEach((link) => issueIds.add(link.issueId));

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

  return issues.map((issue) => ({
    ...issue,
    projectIds: [projectId],
  }));
}
