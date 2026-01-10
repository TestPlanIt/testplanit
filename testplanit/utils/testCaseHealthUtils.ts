import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";

export type HealthStatus =
  | "healthy"
  | "never_executed"
  | "always_passing"
  | "always_failing";

export interface TestCaseHealthRow {
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  createdAt: string;
  lastExecutedAt: string | null;
  daysSinceLastExecution: number | null;
  totalExecutions: number;
  passCount: number;
  failCount: number;
  passRate: number;
  healthStatus: HealthStatus;
  isStale: boolean;
  healthScore: number;
  project?: {
    id: number;
    name?: string;
  };
}

interface RawHealthResult {
  test_case_id: number;
  test_case_name: string;
  test_case_source: string;
  created_at: Date;
  last_executed_at: Date | null;
  total_executions: bigint;
  pass_count: bigint;
  fail_count: bigint;
  project_id?: number;
  project_name?: string;
}

/**
 * Calculate the health status based on execution patterns.
 * Note: Staleness is now a separate flag (isStale), not a status.
 */
export function calculateHealthStatus(
  totalExecutions: number,
  passCount: number,
  failCount: number,
  daysSinceLastExecution: number | null,
  minExecutionsForRate: number
): HealthStatus {
  // Never executed
  if (totalExecutions === 0 || daysSinceLastExecution === null) {
    return "never_executed";
  }

  // Only calculate pass/fail patterns if we have enough executions
  if (totalExecutions >= minExecutionsForRate) {
    // Always failing (0% pass rate)
    if (passCount === 0 && failCount > 0) {
      return "always_failing";
    }

    // Always passing (100% pass rate) - suspicious, might be false positive
    if (passCount === totalExecutions && failCount === 0) {
      return "always_passing";
    }
  }

  return "healthy";
}

/**
 * Calculate if a test case is stale (not run recently).
 */
export function calculateIsStale(
  daysSinceLastExecution: number | null,
  staleDaysThreshold: number
): boolean {
  if (daysSinceLastExecution === null) {
    return false; // Never executed tests are not "stale", they're "never_executed"
  }
  return daysSinceLastExecution > staleDaysThreshold;
}

/**
 * Calculate a health score from 0-100 (higher = healthier).
 */
export function calculateHealthScore(
  totalExecutions: number,
  passCount: number,
  daysSinceLastExecution: number | null,
  minExecutionsForRate: number
): number {
  let score = 100;

  // Deduct for never executed
  if (totalExecutions === 0 || daysSinceLastExecution === null) {
    score -= 50;
    return Math.max(0, score);
  }

  // Deduct for staleness
  if (daysSinceLastExecution > 90) {
    score -= 40;
  } else if (daysSinceLastExecution > 60) {
    score -= 25;
  } else if (daysSinceLastExecution > 30) {
    score -= 10;
  }

  // Only calculate pass rate deductions if we have enough executions
  if (totalExecutions >= minExecutionsForRate) {
    const passRate = (passCount / totalExecutions) * 100;

    // Always passing - suspicious (might be false positive)
    if (passRate === 100) {
      score -= 5;
    }
    // Always failing - broken test
    else if (passRate === 0) {
      score -= 30;
    }
    // Low pass rate
    else if (passRate < 50) {
      score -= 20;
    }
  }

  // Deduct for low execution frequency
  if (totalExecutions < 3 && daysSinceLastExecution !== null) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

export async function handleTestCaseHealthPOST(
  req: NextRequest,
  isCrossProject: boolean
) {
  try {
    // Check admin access for cross-project
    if (isCrossProject) {
      const session = await getServerSession(authOptions);
      if (!session || session.user.access !== "ADMIN") {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const {
      projectId,
      staleDaysThreshold = 30,
      minExecutionsForRate = 5,
      lookbackDays = 90,
      startDate,
      endDate,
      automatedFilter, // "all" | "automated" | "manual"
      dimensions = [],
    } = body;

    // Check if project dimension is requested
    const includeProject = isCrossProject && dimensions.includes("project");

    // Validate parameters
    const staleThreshold = Math.min(
      Math.max(Number(staleDaysThreshold), 7),
      90
    );
    const minExecutions = Math.min(
      Math.max(Number(minExecutionsForRate), 3),
      20
    );
    // 0 means "all time" - no lookback limit
    const lookback = Number(lookbackDays) === 0
      ? 0
      : Math.min(Math.max(Number(lookbackDays), 30), 365);

    // For project-specific, require projectId
    if (!isCrossProject && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Parse dates
    const projectIdNum = projectId ? Number(projectId) : null;

    // Calculate lookback date (null for all time)
    const lookbackDate = lookback === 0 ? null : new Date();
    if (lookbackDate) {
      lookbackDate.setDate(lookbackDate.getDate() - lookback);
    }

    // Determine source filter based on automatedFilter
    const automatedSources = [
      "JUNIT",
      "TESTNG",
      "XUNIT",
      "NUNIT",
      "MSTEST",
      "MOCHA",
      "CUCUMBER",
    ];
    const manualSources = ["MANUAL", "API"];
    const sourceFilter =
      automatedFilter === "automated"
        ? automatedSources
        : automatedFilter === "manual"
          ? manualSources
          : null;

    // Build source filter SQL fragment
    const sourceFilterSql = sourceFilter
      ? Prisma.sql`AND rc.source::text = ANY(${sourceFilter})`
      : Prisma.empty;

    // Build project filter
    const projectFilterSql =
      !isCrossProject && projectIdNum
        ? Prisma.sql`AND rc."projectId" = ${projectIdNum}`
        : Prisma.empty;

    // Build project fields for cross-project queries
    const projectSelectFields = includeProject
      ? Prisma.sql`, p.id as project_id, p.name as project_name`
      : Prisma.empty;
    const projectJoin = includeProject
      ? Prisma.sql`INNER JOIN "Projects" p ON p.id = rc."projectId"`
      : Prisma.empty;
    const projectGroupBy = includeProject
      ? Prisma.sql`, p.id, p.name`
      : Prisma.empty;

    // Build lookback date filter (empty for "all time")
    const manualLookbackFilter = lookbackDate
      ? Prisma.sql`AND trr."executedAt" >= ${lookbackDate}`
      : Prisma.empty;
    const junitLookbackFilter = lookbackDate
      ? Prisma.sql`AND jr."executedAt" >= ${lookbackDate}`
      : Prisma.empty;

    // Query to get test case health data
    // We combine both manual test results (TestRunResults) and automated results (JUnitTestResult)
    // Following the same logic as computeLastTestResult:
    // - For manual: check testRun.isDeleted (not result.isDeleted)
    // - For JUnit: check testSuite.testRun.isDeleted
    //
    // We use INNER JOINs to get actual results (like flaky tests), then LEFT JOIN
    // from all test cases to include cases with no executions
    const rawResults = await prisma.$queryRaw<RawHealthResult[]>`
      WITH execution_results AS (
        -- Manual test results (INNER JOINs to get actual executions)
        SELECT
          rc.id as test_case_id,
          trr."executedAt" as executed_at,
          s."isSuccess" as is_success,
          s."isFailure" as is_failure
        FROM "RepositoryCases" rc
        INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
        INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
        INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id
        INNER JOIN "Status" s ON s.id = trr."statusId"
          AND s."systemName" NOT IN ('untested', 'skipped')
        WHERE rc."isDeleted" = false
          AND rc."isArchived" = false
          ${manualLookbackFilter}
          ${sourceFilterSql}
          ${projectFilterSql}

        UNION ALL

        -- Automated test results (JUnit) - INNER JOINs to get actual executions
        SELECT
          rc.id as test_case_id,
          jr."executedAt" as executed_at,
          COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
          COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure
        FROM "RepositoryCases" rc
        INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
          AND jr.type != 'SKIPPED'
          AND jr."executedAt" IS NOT NULL
        INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
        INNER JOIN "TestRuns" tr ON tr.id = jts."testRunId" AND tr."isDeleted" = false
        LEFT JOIN "Status" s ON s.id = jr."statusId"
        WHERE rc."isDeleted" = false
          AND rc."isArchived" = false
          ${junitLookbackFilter}
          ${sourceFilterSql}
          ${projectFilterSql}
      ),
      aggregated_executions AS (
        SELECT
          test_case_id,
          MAX(executed_at) as last_executed_at,
          COUNT(*) as total_executions,
          SUM(CASE WHEN is_success = true THEN 1 ELSE 0 END) as pass_count,
          SUM(CASE WHEN is_failure = true THEN 1 ELSE 0 END) as fail_count
        FROM execution_results
        GROUP BY test_case_id
      )
      SELECT
        rc.id as test_case_id,
        rc.name as test_case_name,
        rc.source::text as test_case_source,
        rc."createdAt" as created_at,
        ae.last_executed_at,
        COALESCE(ae.total_executions, 0) as total_executions,
        COALESCE(ae.pass_count, 0) as pass_count,
        COALESCE(ae.fail_count, 0) as fail_count
        ${projectSelectFields}
      FROM "RepositoryCases" rc
      ${projectJoin}
      LEFT JOIN aggregated_executions ae ON ae.test_case_id = rc.id
      WHERE rc."isDeleted" = false
        AND rc."isArchived" = false
        ${sourceFilterSql}
        ${projectFilterSql}
      ORDER BY rc.id${includeProject ? Prisma.sql`, p.id` : Prisma.empty}
    `;

    // Process results and calculate health metrics
    const healthResults: TestCaseHealthRow[] = rawResults.map((row) => {
      const totalExecutions = Number(row.total_executions);
      const passCount = Number(row.pass_count);
      const failCount = Number(row.fail_count);

      // Calculate days since last execution
      let daysSinceLastExecution: number | null = null;
      if (row.last_executed_at) {
        const lastExec = new Date(row.last_executed_at);
        const now = new Date();
        daysSinceLastExecution = Math.floor(
          (now.getTime() - lastExec.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      // Calculate pass rate
      const passRate =
        totalExecutions > 0
          ? Math.round((passCount / totalExecutions) * 100)
          : 0;

      // Calculate health status, stale flag, and score
      const healthStatus = calculateHealthStatus(
        totalExecutions,
        passCount,
        failCount,
        daysSinceLastExecution,
        minExecutions
      );

      const isStale = calculateIsStale(daysSinceLastExecution, staleThreshold);

      const healthScore = calculateHealthScore(
        totalExecutions,
        passCount,
        daysSinceLastExecution,
        minExecutions
      );

      return {
        testCaseId: row.test_case_id,
        testCaseName: row.test_case_name,
        testCaseSource: row.test_case_source,
        createdAt: row.created_at.toISOString(),
        lastExecutedAt: row.last_executed_at
          ? row.last_executed_at.toISOString()
          : null,
        daysSinceLastExecution,
        totalExecutions,
        passCount,
        failCount,
        passRate,
        healthStatus,
        isStale,
        healthScore,
        project:
          includeProject && row.project_id
            ? {
                id: row.project_id,
                name: row.project_name,
              }
            : undefined,
      };
    });

    // Sort by health score (lowest first - show unhealthy tests at top)
    healthResults.sort((a, b) => {
      // Primary sort: by health status priority
      const statusPriority: Record<HealthStatus, number> = {
        always_failing: 1,
        never_executed: 2,
        always_passing: 3,
        healthy: 4,
      };
      const statusDiff =
        statusPriority[a.healthStatus] - statusPriority[b.healthStatus];
      if (statusDiff !== 0) return statusDiff;

      // Secondary sort: stale tests first within same status
      if (a.isStale !== b.isStale) {
        return a.isStale ? -1 : 1;
      }

      // Tertiary sort: by health score (lower = worse)
      return a.healthScore - b.healthScore;
    });

    return Response.json({
      data: healthResults,
      total: healthResults.length,
      staleDaysThreshold: staleThreshold,
      minExecutionsForRate: minExecutions,
      lookbackDays: lookback,
    });
  } catch (e: unknown) {
    console.error("Test case health report error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
