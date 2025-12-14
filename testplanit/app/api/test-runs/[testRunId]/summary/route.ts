import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";

const prisma = new PrismaClient();

export type TestRunSummaryData = {
  testRunType: string;
  totalCases: number;
  statusCounts: Array<{
    statusId: number | null;
    statusName: string;
    colorValue: string;
    count: number;
    isCompleted?: boolean;
  }>;
  completionRate: number;
  totalElapsed: number;
  totalEstimate: number;
  commentsCount: number;
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
    issueTypeName: string | null;
    issueTypeIconUrl: string | null;
    integration: {
      id: number;
      provider: string;
      name: string;
    } | null;
    projectIds: number[];
  }>;
  // For JUnit runs
  junitSummary?: {
    totalTests: number;
    totalFailures: number;
    totalErrors: number;
    totalSkipped: number;
    totalTime: number;
    resultSegments: Array<{
      id: string;
      statusName: string;
      statusColor: string;
      resultType: string;
      count: number;
      isAggregate: boolean;
    }>;
  };
  // Minimal case data for tooltips
  caseDetails?: Array<{
    id: number;
    repositoryCaseId: number;
    testRunId: number;
    configurationName: string | null;
    caseName: string;
    statusId: number | null;
    statusName: string;
    colorValue: string;
    executedAt: Date | null;
    executedByName: string | null;
    elapsed: number | null;
    estimate: number | null;
    isPending: boolean;
    resultCount: number;
  }>;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ testRunId: string }> }
) {
  const { testRunId: testRunIdParam } = await params;
  const testRunId = Number(testRunIdParam);

  if (isNaN(testRunId)) {
    return NextResponse.json({ error: "Invalid test run ID" }, { status: 400 });
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get test run type
    const testRun = await prisma.testRuns.findUnique({
      where: { id: testRunId },
      select: {
        testRunType: true,
        forecastManual: true,
        projectId: true,
        issues: {
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
            issueTypeName: true,
            issueTypeIconUrl: true,
            integration: {
              select: {
                id: true,
                provider: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!testRun) {
      return NextResponse.json(
        { error: "Test run not found" },
        { status: 404 }
      );
    }

    const isJUnitRun = isAutomatedTestRunType(testRun.testRunType);

    // Get comments count for this test run
    const commentsCountResult = await prisma.$queryRaw<
      Array<{ count: bigint }>
    >`
      SELECT COUNT(*) as count
      FROM "Comment"
      WHERE "testRunId" = ${testRunId}
        AND "isDeleted" = false
    `;
    const commentsCount = Number(commentsCountResult[0]?.count || 0);

    if (isJUnitRun) {
      // Handle JUnit runs with optimized queries
      const summary = await getJUnitRunSummary(testRunId);
      return NextResponse.json({
        ...summary,
        testRunType: testRun.testRunType,
        commentsCount,
        issues: testRun.issues.map((issue) => ({
          ...issue,
          projectIds: [testRun.projectId],
        })),
      });
    } else {
      // Handle regular test runs with optimized queries
      const summary = await getRegularRunSummary(
        testRunId,
        testRun.forecastManual
      );
      return NextResponse.json({
        ...summary,
        testRunType: testRun.testRunType,
        commentsCount,
        issues: testRun.issues.map((issue) => ({
          ...issue,
          projectIds: [testRun.projectId],
        })),
      });
    }
  } catch (error) {
    console.error("Test run summary error:", error);
    return NextResponse.json(
      { error: "Failed to fetch test run summary" },
      { status: 500 }
    );
  }
}

async function getRegularRunSummary(
  testRunId: number,
  forecastManual: number | null
): Promise<
  Omit<TestRunSummaryData, "testRunType" | "issues" | "commentsCount">
> {
  // Get aggregated status counts using raw SQL for efficiency
  const statusCounts = await prisma.$queryRaw<
    Array<{
      statusId: number | null;
      statusName: string;
      colorValue: string;
      count: bigint;
      isCompleted: boolean | null;
    }>
  >`
    SELECT
      trc."statusId",
      COALESCE(s.name, 'Pending') as "statusName",
      COALESCE(c.value, '#9ca3af') as "colorValue",
      COUNT(*) as count,
      s."isCompleted"
    FROM "TestRunCases" trc
    LEFT JOIN "Status" s ON trc."statusId" = s.id
    LEFT JOIN "Color" c ON s."colorId" = c.id
    WHERE trc."testRunId" = ${testRunId}
    GROUP BY trc."statusId", s.name, c.value, s."isCompleted"
    ORDER BY trc."statusId" ASC NULLS LAST
  `;

  // Get total elapsed time from all results
  const elapsedResult = await prisma.$queryRaw<
    Array<{ totalElapsed: bigint | null }>
  >`
    SELECT
      COALESCE(SUM(
        COALESCE(trr.elapsed, 0) +
        COALESCE((
          SELECT SUM(COALESCE(trsr.elapsed, 0))
          FROM "TestRunStepResults" trsr
          WHERE trsr."testRunResultId" = trr.id
        ), 0)
      ), 0) as "totalElapsed"
    FROM "TestRunResults" trr
    JOIN "TestRunCases" trc ON trr."testRunCaseId" = trc.id
    WHERE trc."testRunId" = ${testRunId}
      AND trr."isDeleted" = false
  `;

  // Get pending case estimates
  const estimateResult = await prisma.$queryRaw<
    Array<{ totalEstimate: bigint | null }>
  >`
    SELECT
      COALESCE(SUM(COALESCE(rc.estimate, 0)), 0) as "totalEstimate"
    FROM "TestRunCases" trc
    JOIN "RepositoryCases" rc ON trc."repositoryCaseId" = rc.id
    LEFT JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
    WHERE trc."testRunId" = ${testRunId}
      AND trr.id IS NULL
  `;

  // Get minimal case details for tooltips (limit to reasonable amount)
  const caseDetails = await prisma.$queryRaw<
    Array<{
      id: number;
      repositoryCaseId: number;
      testRunId: number;
      configurationName: string | null;
      caseName: string;
      statusId: number | null;
      statusName: string;
      colorValue: string;
      executedAt: Date | null;
      executedByName: string | null;
      elapsed: number | null;
      estimate: number | null;
      isPending: boolean;
      resultCount: bigint;
    }>
  >`
    SELECT
      trc.id,
      trc."repositoryCaseId",
      trc."testRunId",
      conf.name as "configurationName",
      rc.name as "caseName",
      trc."statusId",
      COALESCE(s.name, 'Pending') as "statusName",
      COALESCE(c.value, '#9ca3af') as "colorValue",
      latest_result."executedAt",
      u.name as "executedByName",
      latest_result.elapsed,
      rc.estimate,
      CASE WHEN latest_result.id IS NULL THEN true ELSE false END as "isPending",
      COALESCE(result_count.count, 0) as "resultCount"
    FROM "TestRunCases" trc
    JOIN "RepositoryCases" rc ON trc."repositoryCaseId" = rc.id
    JOIN "TestRuns" tr ON trc."testRunId" = tr.id
    LEFT JOIN "Configurations" conf ON tr."configId" = conf.id
    LEFT JOIN "Status" s ON trc."statusId" = s.id
    LEFT JOIN "Color" c ON s."colorId" = c.id
    LEFT JOIN LATERAL (
      SELECT
        trr.id,
        trr."executedAt",
        trr.elapsed,
        trr."executedById"
      FROM "TestRunResults" trr
      WHERE trr."testRunCaseId" = trc.id
        AND trr."isDeleted" = false
      ORDER BY trr."executedAt" DESC
      LIMIT 1
    ) latest_result ON true
    LEFT JOIN "User" u ON latest_result."executedById" = u.id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as count
      FROM "TestRunResults" trr
      WHERE trr."testRunCaseId" = trc.id
        AND trr."isDeleted" = false
    ) result_count ON true
    WHERE trc."testRunId" = ${testRunId}
    ORDER BY trc."order" ASC
    LIMIT 1000
  `;

  const totalCases = statusCounts.reduce(
    (sum, item) => sum + Number(item.count),
    0
  );

  // Calculate completion rate: (completed cases / total cases) × 100
  const completedCases = statusCounts
    .filter((item) => item.isCompleted === true)
    .reduce((sum, item) => sum + Number(item.count), 0);
  const completionRate =
    totalCases > 0 ? Math.min((completedCases / totalCases) * 100, 100) : 0;

  const totalElapsed = Number(elapsedResult[0]?.totalElapsed || 0);
  const totalEstimate =
    forecastManual !== null
      ? forecastManual
      : Number(estimateResult[0]?.totalEstimate || 0);

  return {
    totalCases,
    statusCounts: statusCounts.map((item) => ({
      statusId: item.statusId,
      statusName: item.statusName,
      colorValue: item.colorValue,
      count: Number(item.count),
      isCompleted: item.isCompleted ?? undefined,
    })),
    completionRate,
    totalElapsed,
    totalEstimate,
    caseDetails: caseDetails.map((item) => ({
      ...item,
      resultCount: Number(item.resultCount),
    })),
  };
}

async function getJUnitRunSummary(
  testRunId: number
): Promise<
  Omit<TestRunSummaryData, "testRunType" | "issues" | "commentsCount">
> {
  // Get aggregated result counts by status and type
  // Calculate all stats from actual results to ensure consistency during incremental imports
  const resultAggregates = await prisma.$queryRaw<
    Array<{
      statusId: number | null;
      statusName: string | null;
      colorValue: string | null;
      type: string | null;
      count: bigint;
    }>
  >`
    SELECT
      jtr."statusId",
      s.name as "statusName",
      c.value as "colorValue",
      jtr.type,
      COUNT(*) as count
    FROM "JUnitTestResult" jtr
    JOIN "JUnitTestSuite" jts ON jtr."testSuiteId" = jts.id
    LEFT JOIN "Status" s ON jtr."statusId" = s.id
    LEFT JOIN "Color" c ON s."colorId" = c.id
    WHERE jts."testRunId" = ${testRunId}
    GROUP BY jtr."statusId", s.name, c.value, jtr.type
  `;

  // Get total time from actual results (not suite stats) for consistency
  const timeResult = await prisma.$queryRaw<
    Array<{ totalTime: number | null }>
  >`
    SELECT COALESCE(SUM(jtr.time), 0) as "totalTime"
    FROM "JUnitTestResult" jtr
    JOIN "JUnitTestSuite" jts ON jtr."testSuiteId" = jts.id
    WHERE jts."testRunId" = ${testRunId}
  `;

  // Calculate totals from actual results instead of suite stats
  // This ensures consistency during incremental imports
  const totalTests = resultAggregates.reduce(
    (sum, agg) => sum + Number(agg.count),
    0
  );
  const totalFailures = resultAggregates
    .filter((agg) => agg.type === "FAILURE")
    .reduce((sum, agg) => sum + Number(agg.count), 0);
  const totalErrors = resultAggregates
    .filter((agg) => agg.type === "ERROR")
    .reduce((sum, agg) => sum + Number(agg.count), 0);
  const totalSkipped = resultAggregates
    .filter((agg) => agg.type === "SKIPPED")
    .reduce((sum, agg) => sum + Number(agg.count), 0);
  const totalTime = Number(timeResult[0]?.totalTime || 0);

  // Build result segments
  const resultSegments = resultAggregates.map((agg, index) => {
    const getFallbackColor = (type: string | null) => {
      switch (type) {
        case "FAILURE":
        case "ERROR":
          return "rgb(239, 68, 68)";
        case "SKIPPED":
          return "rgb(161, 161, 170)";
        default:
          return "rgb(34, 197, 94)";
      }
    };

    return {
      id: `aggregate-${agg.statusId ?? "null"}-${agg.type ?? "UNKNOWN"}-${index}`,
      statusName: agg.statusName || agg.type || "PASSED",
      statusColor: agg.colorValue || getFallbackColor(agg.type),
      resultType: agg.type || "PASSED",
      count: Number(agg.count),
      isAggregate: true,
    };
  });

  // Sort by priority: ERROR, FAILURE, SKIPPED, PASSED
  const order: Record<string, number> = {
    ERROR: 0,
    FAILURE: 1,
    SKIPPED: 2,
    PASSED: 3,
  };
  resultSegments.sort((a, b) => {
    const orderA = order[a.resultType] ?? 99;
    const orderB = order[b.resultType] ?? 99;
    return orderA - orderB;
  });

  // Build status counts for the top-level interface
  const statusCounts: TestRunSummaryData["statusCounts"] = [];
  const statusMap = new Map<
    string,
    { statusId: number | null; count: number }
  >();

  resultAggregates.forEach((agg) => {
    const key = `${agg.statusId ?? "null"}-${agg.statusName ?? agg.type}`;
    const existing = statusMap.get(key);
    if (existing) {
      existing.count += Number(agg.count);
    } else {
      statusMap.set(key, {
        statusId: agg.statusId,
        count: Number(agg.count),
      });
      statusCounts.push({
        statusId: agg.statusId,
        statusName: agg.statusName || agg.type || "PASSED",
        colorValue:
          agg.colorValue ||
          (agg.type === "FAILURE" || agg.type === "ERROR"
            ? "rgb(239, 68, 68)"
            : agg.type === "SKIPPED"
              ? "rgb(161, 161, 170)"
              : "rgb(34, 197, 94)"),
        count: Number(agg.count),
      });
    }
  });

  // Calculate completion rate for JUnit runs
  // Consider ERROR and FAILURE as "completed" (tested, even if failed)
  const completedTests = resultAggregates
    .filter(
      (agg) =>
        agg.type === "PASSED" || agg.type === "ERROR" || agg.type === "FAILURE"
    )
    .reduce((sum, agg) => sum + Number(agg.count), 0);
  const completionRate =
    totalTests > 0 ? Math.min((completedTests / totalTests) * 100, 100) : 0;

  return {
    totalCases: totalTests,
    statusCounts,
    completionRate,
    totalElapsed: totalTime,
    totalEstimate: 0,
    junitSummary: {
      totalTests,
      totalFailures,
      totalErrors,
      totalSkipped,
      totalTime,
      resultSegments,
    },
  };
}
