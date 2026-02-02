import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import { prisma } from "~/lib/prisma";
import type { TestRunSummaryData } from "~/app/api/test-runs/[testRunId]/summary/route";

export type BatchTestRunSummaryResponse = {
  summaries: Record<number, TestRunSummaryData>;
};

/**
 * Batch fetch summaries for multiple test runs
 * Query param: testRunIds (comma-separated list of test run IDs)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const testRunIdsParam = searchParams.get("testRunIds");

    if (!testRunIdsParam) {
      return NextResponse.json(
        { error: "testRunIds parameter is required" },
        { status: 400 }
      );
    }

    const testRunIds = testRunIdsParam
      .split(",")
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id));

    if (testRunIds.length === 0) {
      return NextResponse.json(
        { error: "No valid test run IDs provided" },
        { status: 400 }
      );
    }

    // Limit to reasonable batch size
    if (testRunIds.length > 100) {
      return NextResponse.json(
        { error: "Maximum 100 test runs per batch" },
        { status: 400 }
      );
    }

    // Fetch all test runs in one query
    const testRuns = await prisma.testRuns.findMany({
      where: { id: { in: testRunIds } },
      select: {
        id: true,
        testRunType: true,
        forecastManual: true,
        projectId: true,
        state: {
          select: {
            workflowType: true,
          },
        },
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

    if (testRuns.length === 0) {
      return NextResponse.json(
        { summaries: {} },
        { status: 200 }
      );
    }

    // Separate JUnit runs from regular runs
    const junitRunIds: number[] = [];
    const regularRunIds: number[] = [];
    const testRunMap = new Map(testRuns.map((tr) => [tr.id, tr]));

    testRuns.forEach((tr) => {
      if (isAutomatedTestRunType(tr.testRunType)) {
        junitRunIds.push(tr.id);
      } else {
        regularRunIds.push(tr.id);
      }
    });

    // Fetch batch comments counts
    const commentsCountsResult = await prisma.$queryRaw<
      Array<{ testRunId: number; count: bigint }>
    >`
      SELECT "testRunId", COUNT(*) as count
      FROM "Comment"
      WHERE "testRunId" = ANY(${testRunIds})
        AND "isDeleted" = false
      GROUP BY "testRunId"
    `;
    const commentsCounts = new Map(
      commentsCountsResult.map((r) => [r.testRunId, Number(r.count)])
    );

    // Fetch summaries for regular runs
    const regularSummaries = await getBatchRegularRunSummaries(regularRunIds);

    // Fetch summaries for JUnit runs
    const junitSummaries = await getBatchJUnitRunSummaries(junitRunIds);

    // Combine all summaries
    const summaries: Record<number, TestRunSummaryData> = {};

    testRuns.forEach((tr) => {
      const isJUnit = isAutomatedTestRunType(tr.testRunType);
      const summary = isJUnit
        ? junitSummaries.get(tr.id)
        : regularSummaries.get(tr.id);

      if (summary) {
        summaries[tr.id] = {
          ...summary,
          testRunType: tr.testRunType,
          workflowType: tr.state?.workflowType,
          commentsCount: commentsCounts.get(tr.id) || 0,
          issues: tr.issues.map((issue) => ({
            ...issue,
            projectIds: [tr.projectId],
          })),
        };
      }
    });

    return NextResponse.json({ summaries });
  } catch (error) {
    console.error("Batch test run summary error:", error);
    return NextResponse.json(
      { error: "Failed to fetch test run summaries" },
      { status: 500 }
    );
  }
}

async function getBatchRegularRunSummaries(
  testRunIds: number[]
): Promise<Map<number, Omit<TestRunSummaryData, "testRunType" | "issues" | "commentsCount">>> {
  if (testRunIds.length === 0) {
    return new Map();
  }

  // Get aggregated status counts for all test runs in one query
  const statusCounts = await prisma.$queryRaw<
    Array<{
      testRunId: number;
      statusId: number | null;
      statusName: string;
      colorValue: string;
      count: bigint;
      isCompleted: boolean | null;
    }>
  >`
    SELECT
      trc."testRunId",
      trc."statusId",
      COALESCE(s.name, 'Pending') as "statusName",
      COALESCE(c.value, '#9ca3af') as "colorValue",
      COUNT(*) as count,
      s."isCompleted"
    FROM "TestRunCases" trc
    LEFT JOIN "Status" s ON trc."statusId" = s.id
    LEFT JOIN "Color" c ON s."colorId" = c.id
    WHERE trc."testRunId" = ANY(${testRunIds})
    GROUP BY trc."testRunId", trc."statusId", s.name, c.value, s."isCompleted"
    ORDER BY trc."testRunId", trc."statusId" ASC NULLS LAST
  `;

  // Get total elapsed time for all test runs in one query
  const elapsedResults = await prisma.$queryRaw<
    Array<{ testRunId: number; totalElapsed: bigint | null }>
  >`
    SELECT
      trc."testRunId",
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
    WHERE trc."testRunId" = ANY(${testRunIds})
      AND trr."isDeleted" = false
    GROUP BY trc."testRunId"
  `;

  // Get pending case estimates for all test runs in one query
  const estimateResults = await prisma.$queryRaw<
    Array<{ testRunId: number; totalEstimate: bigint | null }>
  >`
    SELECT
      trc."testRunId",
      COALESCE(SUM(COALESCE(rc.estimate, 0)), 0) as "totalEstimate"
    FROM "TestRunCases" trc
    JOIN "RepositoryCases" rc ON trc."repositoryCaseId" = rc.id
    LEFT JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
    WHERE trc."testRunId" = ANY(${testRunIds})
      AND trr.id IS NULL
    GROUP BY trc."testRunId"
  `;

  // Get lightweight case details for status bars (simplified query without subqueries)
  // We'll just get the basic info and skip detailed result info to keep it fast
  type CaseDetail = {
    testRunId: number;
    id: number;
    repositoryCaseId: number;
    configurationName: string | null;
    caseName: string;
    statusId: number | null;
    statusName: string;
    colorValue: string;
    estimate: number | null;
    isPending: boolean;
  };
  const caseDetails = await prisma.$queryRaw<Array<CaseDetail>>`
    SELECT
      trc."testRunId",
      trc.id,
      trc."repositoryCaseId",
      conf.name as "configurationName",
      rc.name as "caseName",
      trc."statusId",
      COALESCE(s.name, 'Pending') as "statusName",
      COALESCE(c.value, '#9ca3af') as "colorValue",
      rc.estimate,
      (trc."statusId" IS NULL OR s."isCompleted" = false) as "isPending"
    FROM "TestRunCases" trc
    JOIN "RepositoryCases" rc ON trc."repositoryCaseId" = rc.id
    JOIN "TestRuns" tr ON trc."testRunId" = tr.id
    LEFT JOIN "Configurations" conf ON tr."configId" = conf.id
    LEFT JOIN "Status" s ON trc."statusId" = s.id
    LEFT JOIN "Color" c ON s."colorId" = c.id
    WHERE trc."testRunId" = ANY(${testRunIds})
    ORDER BY trc."testRunId", trc."order" ASC
  `;

  // Get forecasts for test runs
  const testRuns = await prisma.testRuns.findMany({
    where: { id: { in: testRunIds } },
    select: { id: true, forecastManual: true },
  });
  const forecastMap = new Map(
    testRuns.map((tr) => [tr.id, tr.forecastManual])
  );

  // Build summary map
  const summaries = new Map<
    number,
    Omit<TestRunSummaryData, "testRunType" | "issues" | "commentsCount">
  >();

  const elapsedMap = new Map(
    elapsedResults.map((r) => [r.testRunId, Number(r.totalElapsed || 0)])
  );
  const estimateMap = new Map(
    estimateResults.map((r) => [r.testRunId, Number(r.totalEstimate || 0)])
  );

  // Group status counts by test run
  const statusCountsByRun = new Map<
    number,
    Array<{
      statusId: number | null;
      statusName: string;
      colorValue: string;
      count: number;
      isCompleted?: boolean;
    }>
  >();

  statusCounts.forEach((sc) => {
    if (!statusCountsByRun.has(sc.testRunId)) {
      statusCountsByRun.set(sc.testRunId, []);
    }
    statusCountsByRun.get(sc.testRunId)!.push({
      statusId: sc.statusId,
      statusName: sc.statusName,
      colorValue: sc.colorValue,
      count: Number(sc.count),
      isCompleted: sc.isCompleted ?? undefined,
    });
  });

  // Group case details by test run
  const caseDetailsByRun = new Map<number, Array<typeof caseDetails[0]>>();
  caseDetails.forEach((detail) => {
    if (!caseDetailsByRun.has(detail.testRunId)) {
      caseDetailsByRun.set(detail.testRunId, []);
    }
    caseDetailsByRun.get(detail.testRunId)!.push(detail);
  });

  // Build summaries for each test run
  testRunIds.forEach((testRunId) => {
    const statusCountsForRun = statusCountsByRun.get(testRunId) || [];
    const totalCases = statusCountsForRun.reduce((sum, sc) => sum + sc.count, 0);
    const completedCases = statusCountsForRun
      .filter((sc) => sc.isCompleted === true)
      .reduce((sum, sc) => sum + sc.count, 0);
    const completionRate =
      totalCases > 0 ? Math.min((completedCases / totalCases) * 100, 100) : 0;

    const totalElapsed = elapsedMap.get(testRunId) || 0;
    const forecastManual = forecastMap.get(testRunId);
    const totalEstimate =
      forecastManual !== null && forecastManual !== undefined
        ? forecastManual
        : estimateMap.get(testRunId) || 0;

    const caseDetailsForRun = caseDetailsByRun.get(testRunId) || [];

    summaries.set(testRunId, {
      totalCases,
      statusCounts: statusCountsForRun,
      completionRate,
      totalElapsed,
      totalEstimate,
      caseDetails: caseDetailsForRun.map((detail) => ({
        id: detail.id,
        repositoryCaseId: detail.repositoryCaseId,
        testRunId: detail.testRunId,
        configurationName: detail.configurationName,
        caseName: detail.caseName,
        statusId: detail.statusId,
        statusName: detail.statusName,
        colorValue: detail.colorValue,
        estimate: detail.estimate,
        isPending: detail.isPending,
      })),
    });
  });

  return summaries;
}

async function getBatchJUnitRunSummaries(
  testRunIds: number[]
): Promise<Map<number, Omit<TestRunSummaryData, "testRunType" | "issues" | "commentsCount">>> {
  if (testRunIds.length === 0) {
    return new Map();
  }

  // Get aggregated result counts by status and type for all test runs
  const resultAggregates = await prisma.$queryRaw<
    Array<{
      testRunId: number;
      statusId: number | null;
      statusName: string | null;
      colorValue: string | null;
      type: string | null;
      count: bigint;
    }>
  >`
    SELECT
      jts."testRunId",
      jtr."statusId",
      s.name as "statusName",
      c.value as "colorValue",
      jtr.type,
      COUNT(*) as count
    FROM "JUnitTestResult" jtr
    JOIN "JUnitTestSuite" jts ON jtr."testSuiteId" = jts.id
    LEFT JOIN "Status" s ON jtr."statusId" = s.id
    LEFT JOIN "Color" c ON s."colorId" = c.id
    WHERE jts."testRunId" = ANY(${testRunIds})
    GROUP BY jts."testRunId", jtr."statusId", s.name, c.value, jtr.type
  `;

  // Get total time from actual results for all test runs
  const timeResults = await prisma.$queryRaw<
    Array<{ testRunId: number; totalTime: number | null }>
  >`
    SELECT
      jts."testRunId",
      COALESCE(SUM(jtr.time), 0) as "totalTime"
    FROM "JUnitTestResult" jtr
    JOIN "JUnitTestSuite" jts ON jtr."testSuiteId" = jts.id
    WHERE jts."testRunId" = ANY(${testRunIds})
    GROUP BY jts."testRunId"
  `;

  const timeMap = new Map(
    timeResults.map((r) => [r.testRunId, Number(r.totalTime || 0)])
  );

  // Group aggregates by test run
  const aggregatesByRun = new Map<
    number,
    Array<{
      statusId: number | null;
      statusName: string | null;
      colorValue: string | null;
      type: string | null;
      count: number;
    }>
  >();

  resultAggregates.forEach((agg) => {
    if (!aggregatesByRun.has(agg.testRunId)) {
      aggregatesByRun.set(agg.testRunId, []);
    }
    aggregatesByRun.get(agg.testRunId)!.push({
      statusId: agg.statusId,
      statusName: agg.statusName,
      colorValue: agg.colorValue,
      type: agg.type,
      count: Number(agg.count),
    });
  });

  // Build summaries for each test run
  const summaries = new Map<
    number,
    Omit<TestRunSummaryData, "testRunType" | "issues" | "commentsCount">
  >();

  const order: Record<string, number> = {
    ERROR: 0,
    FAILURE: 1,
    SKIPPED: 2,
    PASSED: 3,
  };

  testRunIds.forEach((testRunId) => {
    const aggregates = aggregatesByRun.get(testRunId) || [];

    const totalTests = aggregates.reduce((sum, agg) => sum + agg.count, 0);
    const totalFailures = aggregates
      .filter((agg) => agg.type === "FAILURE")
      .reduce((sum, agg) => sum + agg.count, 0);
    const totalErrors = aggregates
      .filter((agg) => agg.type === "ERROR")
      .reduce((sum, agg) => sum + agg.count, 0);
    const totalSkipped = aggregates
      .filter((agg) => agg.type === "SKIPPED")
      .reduce((sum, agg) => sum + agg.count, 0);
    const totalTime = timeMap.get(testRunId) || 0;

    // Build result segments
    const resultSegments = aggregates.map((agg, index) => {
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
        count: agg.count,
        isAggregate: true,
      };
    });

    // Sort by priority
    resultSegments.sort((a, b) => {
      const orderA = order[a.resultType] ?? 99;
      const orderB = order[b.resultType] ?? 99;
      return orderA - orderB;
    });

    // Build status counts
    const statusCounts: TestRunSummaryData["statusCounts"] = [];
    const statusMap = new Map<
      string,
      { statusId: number | null; count: number }
    >();

    aggregates.forEach((agg) => {
      const key = `${agg.statusId ?? "null"}-${agg.statusName ?? agg.type}`;
      const existing = statusMap.get(key);
      if (existing) {
        existing.count += agg.count;
      } else {
        statusMap.set(key, {
          statusId: agg.statusId,
          count: agg.count,
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
          count: agg.count,
        });
      }
    });

    // Calculate completion rate
    const completedTests = aggregates
      .filter(
        (agg) =>
          agg.type === "PASSED" || agg.type === "ERROR" || agg.type === "FAILURE"
      )
      .reduce((sum, agg) => sum + agg.count, 0);
    const completionRate =
      totalTests > 0 ? Math.min((completedTests / totalTests) * 100, 100) : 0;

    summaries.set(testRunId, {
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
    });
  });

  return summaries;
}
