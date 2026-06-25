import type { TxClient } from "~/lib/zenstack";

import { baseDb } from "~/lib/db";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";

// Type + pure aggregation helper live in a client-safe sibling so the
// in-app summary component (a client component) can import them without
// pulling Prisma into the browser bundle. Re-exported here so existing
// server-side imports of `~/lib/services/testRunSummary` keep working.
export type {
  TestRunSummaryData,
  RunSummaryAggregates,
  PerCaseIterationCounts,
} from "./testRunSummary-shared";
export { aggregateRunCounts } from "./testRunSummary-shared";
import type {
  TestRunSummaryData,
  PerCaseIterationCounts,
} from "./testRunSummary-shared";

/**
 * Accept either the singleton client or a `TxClient` so the
 * webhook emitter can pass `tx` (Plan 02-05 Task 5.2) and read post-write
 * state inside the same transaction that produced the emission.
 */
type PrismaLike = typeof baseDb | TxClient;

/**
 * Compute the test run summary data shape used by the in-app summary UI
 * (components/TestRunCasesSummary.tsx) and — per D-15 — by the
 * test_run.completed outbound webhook payload.
 *
 * @param testRunId The TestRuns.id (number).
 * @param options.includeCaseDetails When true, fetch the per-case detail
 *   array (requires extra LATERAL joins — only used by the in-app detail
 *   view; the webhook emitter omits it).
 * @param options.client Optional client override; defaults to the singleton.
 *   Pass a `TxClient` to read inside an active tx.
 */
export async function getTestRunSummary(
  testRunId: number,
  options: { includeCaseDetails?: boolean; client?: PrismaLike } = {}
): Promise<TestRunSummaryData> {
  const client: PrismaLike = options.client ?? baseDb;
  const includeCaseDetails = options.includeCaseDetails ?? false;

  // Get test run type and workflow + linked issues
  const testRun = await client.testRuns.findUnique({
    where: { id: testRunId },
    select: {
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

  if (!testRun) {
    throw new TestRunNotFoundError(testRunId);
  }

  const isJUnitRun = isAutomatedTestRunType(testRun.testRunType);

  const commentsCountResult = await client.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count
    FROM "Comment"
    WHERE "testRunId" = ${testRunId}
      AND "isDeleted" = false
  `;
  const commentsCount = Number(commentsCountResult[0]?.count || 0);

  const baseSummary = isJUnitRun
    ? await getJUnitRunSummary(testRunId, client)
    : await getRegularRunSummary(
        testRunId,
        testRun.forecastManual,
        includeCaseDetails,
        client
      );

  return {
    ...baseSummary,
    testRunType: testRun.testRunType,
    workflowType: testRun.state?.workflowType ?? null,
    commentsCount,
    issues: testRun.issues.map((issue) => ({
      ...issue,
      projectIds: [testRun.projectId],
    })),
  };
}

/**
 * Distinguishes "test run not found" from generic DB errors so the route
 * handler can return 404 while the webhook emitter swallows / retries.
 */
export class TestRunNotFoundError extends Error {
  constructor(public testRunId: number) {
    super(`Test run not found: ${testRunId}`);
    this.name = "TestRunNotFoundError";
  }
}

export async function getRegularRunSummary(
  testRunId: number,
  forecastManual: number | null,
  includeCaseDetails: boolean,
  client: PrismaLike = baseDb
): Promise<
  Omit<TestRunSummaryData, "testRunType" | "issues" | "commentsCount">
> {
  const statusCounts = await client.$queryRaw<
    Array<{
      statusId: number | null;
      statusName: string;
      colorValue: string;
      count: bigint;
      isCompleted: boolean | null;
      isSuccess: boolean | null;
      isFailure: boolean | null;
    }>
  >`
    SELECT
      trc."statusId",
      COALESCE(s.name, 'Pending') as "statusName",
      COALESCE(c.value, '#9ca3af') as "colorValue",
      COUNT(*) as count,
      s."isCompleted",
      s."isSuccess",
      s."isFailure"
    FROM "TestRunCases" trc
    LEFT JOIN "Status" s ON trc."statusId" = s.id
    LEFT JOIN "Color" c ON s."colorId" = c.id
    WHERE trc."testRunId" = ${testRunId}
    GROUP BY trc."statusId", s.name, c.value, s."isCompleted", s."isSuccess", s."isFailure"
    ORDER BY trc."statusId" ASC NULLS LAST
  `;

  const elapsedResult = await client.$queryRaw<
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

  const estimateResult = await client.$queryRaw<
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

  let caseDetails: Array<{
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
    statusOrder: number | null;
  }> = [];

  if (includeCaseDetails) {
    caseDetails = await client.$queryRaw<typeof caseDetails>`
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
        COALESCE(result_count.count, 0) as "resultCount",
        s.order as "statusOrder"
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
  }

  const totalCases = statusCounts.reduce(
    (sum, item) => sum + Number(item.count),
    0
  );

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

  const result: Omit<
    TestRunSummaryData,
    "testRunType" | "issues" | "commentsCount"
  > = {
    totalCases,
    statusCounts: statusCounts.map((item) => ({
      statusId: item.statusId,
      statusName: item.statusName,
      colorValue: item.colorValue,
      count: Number(item.count),
      isCompleted: item.isCompleted ?? undefined,
      isSuccess: item.isSuccess ?? undefined,
      isFailure: item.isFailure ?? undefined,
    })),
    completionRate,
    totalElapsed,
    totalEstimate,
  };

  if (includeCaseDetails) {
    result.caseDetails = caseDetails.map((item) => ({
      ...item,
      resultCount: Number(item.resultCount),
    }));
  }

  return result;
}

export async function getJUnitRunSummary(
  testRunId: number,
  client: PrismaLike = baseDb
): Promise<
  Omit<TestRunSummaryData, "testRunType" | "issues" | "commentsCount">
> {
  const resultAggregates = await client.$queryRaw<
    Array<{
      statusId: number | null;
      statusName: string | null;
      colorValue: string | null;
      type: string | null;
      count: bigint;
      isCompleted: boolean | null;
      isSuccess: boolean | null;
      isFailure: boolean | null;
    }>
  >`
    SELECT
      jtr."statusId",
      s.name as "statusName",
      c.value as "colorValue",
      jtr.type,
      COUNT(*) as count,
      s."isCompleted",
      s."isSuccess",
      s."isFailure"
    FROM "JUnitTestResult" jtr
    JOIN "JUnitTestSuite" jts ON jtr."testSuiteId" = jts.id
    LEFT JOIN "Status" s ON jtr."statusId" = s.id
    LEFT JOIN "Color" c ON s."colorId" = c.id
    WHERE jts."testRunId" = ${testRunId}
    GROUP BY jtr."statusId", s.name, c.value, jtr.type, s."isCompleted", s."isSuccess", s."isFailure"
  `;

  const timeResult = await client.$queryRaw<
    Array<{ totalTime: number | null }>
  >`
    SELECT COALESCE(SUM(jtr.time), 0) as "totalTime"
    FROM "JUnitTestResult" jtr
    JOIN "JUnitTestSuite" jts ON jtr."testSuiteId" = jts.id
    WHERE jts."testRunId" = ${testRunId}
  `;

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
        // Status-table flags when joined; fall back to JUnit `type` for unmapped junit results.
        isCompleted: agg.isCompleted ?? agg.type != null,
        isSuccess: agg.isSuccess ?? (agg.type === "PASSED" ? true : undefined),
        isFailure:
          agg.isFailure ??
          (agg.type === "FAILURE" || agg.type === "ERROR" ? true : undefined),
      });
    }
  });

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

/**
 * Read per-case iteration counts from the denormalized counters on
 * TestRunCases (INT-03 / D-04 / D-14). Non-parameterized cases report
 * `iterationCount: 0` and zeros across all four buckets — required by the
 * INT-03 acceptance criterion that non-parameterized cases must not report
 * false-positive iteration counts.
 *
 * `notRun` is derived: `max(total - passed - failed - skipped, 0)`. The
 * clamp guards against transient inconsistencies between the counters and
 * `totalIterations` (e.g., the denormalizer wrote a counter higher than
 * total) so the webhook payload never carries a negative count.
 *
 * Pure read — no joins, no aggregates, single SELECT against TestRunCases.
 * Safe to call inside the same transaction as `getTestRunSummary` so the
 * webhook emitter sees a consistent post-write snapshot.
 */
export async function getPerCaseIterationCounts(
  testRunId: number,
  client: PrismaLike = baseDb
): Promise<PerCaseIterationCounts[]> {
  const rows = await client.testRunCases.findMany({
    where: { testRunId, isDeleted: false },
    select: {
      id: true,
      passedIterations: true,
      failedIterations: true,
      skippedIterations: true,
      totalIterations: true,
    },
    orderBy: { order: "asc" },
  });
  return rows.map((row) => {
    const total = row.totalIterations;
    const passed = row.passedIterations;
    const failed = row.failedIterations;
    const skipped = row.skippedIterations;
    const notRun = Math.max(total - passed - failed - skipped, 0);
    return {
      testRunCaseId: row.id,
      iterationCount: total,
      iterationsByStatus: {
        passed,
        failed,
        skipped,
        notRun,
      },
    };
  });
}
