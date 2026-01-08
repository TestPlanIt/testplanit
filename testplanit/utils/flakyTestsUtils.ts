import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";

interface ExecutionStatus {
  resultId: number;
  testRunId: number | null;
  statusName: string;
  statusColor: string;
  isSuccess: boolean;
  isFailure: boolean;
  executedAt: string;
}

interface FlakyTestRow {
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  flipCount: number;
  executions: ExecutionStatus[];
  project?: {
    id: number;
    name?: string;
  };
}

interface RawExecutionResult {
  test_case_id: number;
  test_case_name: string;
  test_case_source: string;
  result_id: number;
  test_run_id: number | null;
  status_name: string;
  status_color: string;
  is_success: boolean;
  is_failure: boolean;
  executed_at: Date;
  row_num: bigint;
  project_id?: number;
  project_name?: string;
}

/**
 * Count the number of status flips (transitions between success and failure) in a sequence of executions.
 * Only counts transitions between definitive results (isSuccess or isFailure).
 * Results that are neither success nor failure (e.g., blocked, retest) are skipped.
 */
export function countStatusFlips(executions: ExecutionStatus[]): number {
  let flips = 0;
  let lastDefinitiveResult: boolean | null = null;

  for (const execution of executions) {
    // Only consider definitive results (success or failure)
    const isDefinitive = execution.isSuccess || execution.isFailure;
    if (!isDefinitive) {
      continue;
    }

    const currentIsSuccess = execution.isSuccess;

    // If we have a previous definitive result and it differs, count as flip
    if (lastDefinitiveResult !== null && currentIsSuccess !== lastDefinitiveResult) {
      flips++;
    }

    lastDefinitiveResult = currentIsSuccess;
  }

  return flips;
}

/**
 * Check if a test case qualifies as flaky based on its execution history.
 * A test is flaky if it has both success and failure results within the executions.
 */
function hasRequiredFlakiness(executions: ExecutionStatus[]): boolean {
  let hasSuccess = false;
  let hasFailure = false;

  for (const execution of executions) {
    if (execution.isSuccess) hasSuccess = true;
    if (execution.isFailure) hasFailure = true;
    if (hasSuccess && hasFailure) return true;
  }

  return false;
}

export async function handleFlakyTestsPOST(
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
      consecutiveRuns = 10,
      flipThreshold = 5,
      startDate,
      endDate,
      automatedFilter, // "all" | "automated" | "manual"
      dimensions = [], // Array of dimension IDs
    } = body;
    
    // Check if project dimension is requested
    const includeProject = isCrossProject && dimensions.includes("project");

    // Validate parameters
    const runs = Math.min(Math.max(Number(consecutiveRuns), 5), 30);
    const threshold = Math.min(Math.max(Number(flipThreshold), 2), runs - 1);

    // For project-specific, require projectId
    if (!isCrossProject && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Parse dates
    const startDateParsed = startDate ? new Date(startDate) : null;
    const endDateParsed = endDate ? new Date(endDate) : null;
    const projectIdNum = projectId ? Number(projectId) : null;

    // Determine source filter based on automatedFilter
    // Automated sources: JUNIT, TESTNG, XUNIT, NUNIT, MSTEST, MOCHA, CUCUMBER
    // Manual sources: MANUAL, API
    const automatedSources = ["JUNIT", "TESTNG", "XUNIT", "NUNIT", "MSTEST", "MOCHA", "CUCUMBER"];
    const manualSources = ["MANUAL", "API"];
    const sourceFilter = automatedFilter === "automated"
      ? automatedSources
      : automatedFilter === "manual"
        ? manualSources
        : null; // null means no filter (show all)

    // Build source filter SQL fragment
    const sourceFilterSql = sourceFilter
      ? Prisma.sql`AND rc.source::text = ANY(${sourceFilter})`
      : Prisma.empty;

    // Use raw SQL with window functions to efficiently get recent results per test case
    // Build query based on whether it's cross-project and date filters
    let rawResults: RawExecutionResult[];

    if (isCrossProject) {
      // Build project fields for SELECT and PARTITION BY
      const projectSelectFields = includeProject
        ? Prisma.sql`, p.id as project_id, p.name as project_name`
        : Prisma.empty;
      const projectJoin = includeProject
        ? Prisma.sql`INNER JOIN "Projects" p ON p.id = rc."projectId"`
        : Prisma.empty;
      const partitionBy = includeProject
        ? Prisma.sql`PARTITION BY test_case_id, project_id`
        : Prisma.sql`PARTITION BY test_case_id`;

      if (startDateParsed && endDateParsed) {
        rawResults = await prisma.$queryRaw<RawExecutionResult[]>`
          WITH combined_results AS (
            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              trr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN trc."testRunId" ELSE NULL END as test_run_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
              ${projectSelectFields}
            FROM "RepositoryCases" rc
            ${projectJoin}
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            LEFT JOIN "TestRuns" tr ON tr.id = trc."testRunId"
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND trr."executedAt" >= ${startDateParsed}
              AND trr."executedAt" <= ${endDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              jr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN jts."testRunId" ELSE NULL END as test_run_id,
              COALESCE(s.name, jr.type::text) as status_name,
              COALESCE(c.value,
                CASE jr.type
                  WHEN 'PASSED' THEN '#22c55e'
                  WHEN 'FAILURE' THEN '#ef4444'
                  WHEN 'ERROR' THEN '#f97316'
                  ELSE '#6b7280'
                END
              ) as status_color,
              COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
              COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure,
              jr."executedAt" as executed_at
              ${projectSelectFields}
            FROM "RepositoryCases" rc
            ${projectJoin}
            INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
            INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
            LEFT JOIN "TestRuns" tr ON tr.id = jts."testRunId"
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" >= ${startDateParsed}
              AND jr."executedAt" <= ${endDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              test_case_source,
              result_id,
              test_run_id,
              status_name,
              status_color,
              is_success,
              is_failure,
              executed_at
              ${includeProject ? Prisma.sql`, project_id, project_name` : Prisma.empty},
              ROW_NUMBER() OVER (${partitionBy} ORDER BY executed_at DESC) as row_num
            FROM combined_results
          )
          SELECT * FROM ranked_results WHERE row_num <= ${runs} ORDER BY test_case_id${includeProject ? Prisma.sql`, project_id` : Prisma.empty}, row_num
        `;
      } else if (startDateParsed) {
        rawResults = await prisma.$queryRaw<RawExecutionResult[]>`
          WITH combined_results AS (
            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              trr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN trc."testRunId" ELSE NULL END as test_run_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
              ${projectSelectFields}
            FROM "RepositoryCases" rc
            ${projectJoin}
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            LEFT JOIN "TestRuns" tr ON tr.id = trc."testRunId"
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND trr."executedAt" >= ${startDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              jr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN jts."testRunId" ELSE NULL END as test_run_id,
              COALESCE(s.name, jr.type::text) as status_name,
              COALESCE(c.value,
                CASE jr.type
                  WHEN 'PASSED' THEN '#22c55e'
                  WHEN 'FAILURE' THEN '#ef4444'
                  WHEN 'ERROR' THEN '#f97316'
                  ELSE '#6b7280'
                END
              ) as status_color,
              COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
              COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure,
              jr."executedAt" as executed_at
              ${projectSelectFields}
            FROM "RepositoryCases" rc
            ${projectJoin}
            INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
            INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
            LEFT JOIN "TestRuns" tr ON tr.id = jts."testRunId"
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" >= ${startDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              test_case_source,
              result_id,
              test_run_id,
              status_name,
              status_color,
              is_success,
              is_failure,
              executed_at
              ${includeProject ? Prisma.sql`, project_id, project_name` : Prisma.empty},
              ROW_NUMBER() OVER (${partitionBy} ORDER BY executed_at DESC) as row_num
            FROM combined_results
          )
          SELECT * FROM ranked_results WHERE row_num <= ${runs} ORDER BY test_case_id${includeProject ? Prisma.sql`, project_id` : Prisma.empty}, row_num
        `;
      } else if (endDateParsed) {
        rawResults = await prisma.$queryRaw<RawExecutionResult[]>`
          WITH combined_results AS (
            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              trr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN trc."testRunId" ELSE NULL END as test_run_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
              ${projectSelectFields}
            FROM "RepositoryCases" rc
            ${projectJoin}
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            LEFT JOIN "TestRuns" tr ON tr.id = trc."testRunId"
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND trr."executedAt" <= ${endDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              jr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN jts."testRunId" ELSE NULL END as test_run_id,
              COALESCE(s.name, jr.type::text) as status_name,
              COALESCE(c.value,
                CASE jr.type
                  WHEN 'PASSED' THEN '#22c55e'
                  WHEN 'FAILURE' THEN '#ef4444'
                  WHEN 'ERROR' THEN '#f97316'
                  ELSE '#6b7280'
                END
              ) as status_color,
              COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
              COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure,
              jr."executedAt" as executed_at
              ${projectSelectFields}
            FROM "RepositoryCases" rc
            ${projectJoin}
            INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
            INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
            LEFT JOIN "TestRuns" tr ON tr.id = jts."testRunId"
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" <= ${endDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              test_case_source,
              result_id,
              test_run_id,
              status_name,
              status_color,
              is_success,
              is_failure,
              executed_at
              ${includeProject ? Prisma.sql`, project_id, project_name` : Prisma.empty},
              ROW_NUMBER() OVER (${partitionBy} ORDER BY executed_at DESC) as row_num
            FROM combined_results
          )
          SELECT * FROM ranked_results WHERE row_num <= ${runs} ORDER BY test_case_id${includeProject ? Prisma.sql`, project_id` : Prisma.empty}, row_num
        `;
      } else {
        rawResults = await prisma.$queryRaw<RawExecutionResult[]>`
          WITH combined_results AS (
            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              trr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN trc."testRunId" ELSE NULL END as test_run_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
              ${projectSelectFields}
            FROM "RepositoryCases" rc
            ${projectJoin}
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            LEFT JOIN "TestRuns" tr ON tr.id = trc."testRunId"
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              jr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN jts."testRunId" ELSE NULL END as test_run_id,
              COALESCE(s.name, jr.type::text) as status_name,
              COALESCE(c.value,
                CASE jr.type
                  WHEN 'PASSED' THEN '#22c55e'
                  WHEN 'FAILURE' THEN '#ef4444'
                  WHEN 'ERROR' THEN '#f97316'
                  ELSE '#6b7280'
                END
              ) as status_color,
              COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
              COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure,
              jr."executedAt" as executed_at
              ${projectSelectFields}
            FROM "RepositoryCases" rc
            ${projectJoin}
            INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
            INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
            LEFT JOIN "TestRuns" tr ON tr.id = jts."testRunId"
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              test_case_source,
              result_id,
              test_run_id,
              status_name,
              status_color,
              is_success,
              is_failure,
              executed_at
              ${includeProject ? Prisma.sql`, project_id, project_name` : Prisma.empty},
              ROW_NUMBER() OVER (${partitionBy} ORDER BY executed_at DESC) as row_num
            FROM combined_results
          )
          SELECT * FROM ranked_results WHERE row_num <= ${runs} ORDER BY test_case_id${includeProject ? Prisma.sql`, project_id` : Prisma.empty}, row_num
        `;
      }
    } else {
      // Project-specific queries
      if (startDateParsed && endDateParsed) {
        rawResults = await prisma.$queryRaw<RawExecutionResult[]>`
          WITH combined_results AS (
            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              trr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN trc."testRunId" ELSE NULL END as test_run_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            LEFT JOIN "TestRuns" tr ON tr.id = trc."testRunId"
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND rc."projectId" = ${projectIdNum}
              AND trr."executedAt" >= ${startDateParsed}
              AND trr."executedAt" <= ${endDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              jr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN jts."testRunId" ELSE NULL END as test_run_id,
              COALESCE(s.name, jr.type::text) as status_name,
              COALESCE(c.value,
                CASE jr.type
                  WHEN 'PASSED' THEN '#22c55e'
                  WHEN 'FAILURE' THEN '#ef4444'
                  WHEN 'ERROR' THEN '#f97316'
                  ELSE '#6b7280'
                END
              ) as status_color,
              COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
              COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure,
              jr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
            INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
            LEFT JOIN "TestRuns" tr ON tr.id = jts."testRunId"
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND rc."projectId" = ${projectIdNum}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" >= ${startDateParsed}
              AND jr."executedAt" <= ${endDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              test_case_source,
              result_id,
              test_run_id,
              status_name,
              status_color,
              is_success,
              is_failure,
              executed_at,
              ROW_NUMBER() OVER (PARTITION BY test_case_id ORDER BY executed_at DESC) as row_num
            FROM combined_results
          )
          SELECT * FROM ranked_results WHERE row_num <= ${runs} ORDER BY test_case_id, row_num
        `;
      } else if (startDateParsed) {
        rawResults = await prisma.$queryRaw<RawExecutionResult[]>`
          WITH combined_results AS (
            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              trr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN trc."testRunId" ELSE NULL END as test_run_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            LEFT JOIN "TestRuns" tr ON tr.id = trc."testRunId"
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND rc."projectId" = ${projectIdNum}
              AND trr."executedAt" >= ${startDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              jr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN jts."testRunId" ELSE NULL END as test_run_id,
              COALESCE(s.name, jr.type::text) as status_name,
              COALESCE(c.value,
                CASE jr.type
                  WHEN 'PASSED' THEN '#22c55e'
                  WHEN 'FAILURE' THEN '#ef4444'
                  WHEN 'ERROR' THEN '#f97316'
                  ELSE '#6b7280'
                END
              ) as status_color,
              COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
              COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure,
              jr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
            INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
            LEFT JOIN "TestRuns" tr ON tr.id = jts."testRunId"
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND rc."projectId" = ${projectIdNum}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" >= ${startDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              test_case_source,
              result_id,
              test_run_id,
              status_name,
              status_color,
              is_success,
              is_failure,
              executed_at,
              ROW_NUMBER() OVER (PARTITION BY test_case_id ORDER BY executed_at DESC) as row_num
            FROM combined_results
          )
          SELECT * FROM ranked_results WHERE row_num <= ${runs} ORDER BY test_case_id, row_num
        `;
      } else if (endDateParsed) {
        rawResults = await prisma.$queryRaw<RawExecutionResult[]>`
          WITH combined_results AS (
            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              trr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN trc."testRunId" ELSE NULL END as test_run_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            LEFT JOIN "TestRuns" tr ON tr.id = trc."testRunId"
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND rc."projectId" = ${projectIdNum}
              AND trr."executedAt" <= ${endDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              jr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN jts."testRunId" ELSE NULL END as test_run_id,
              COALESCE(s.name, jr.type::text) as status_name,
              COALESCE(c.value,
                CASE jr.type
                  WHEN 'PASSED' THEN '#22c55e'
                  WHEN 'FAILURE' THEN '#ef4444'
                  WHEN 'ERROR' THEN '#f97316'
                  ELSE '#6b7280'
                END
              ) as status_color,
              COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
              COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure,
              jr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
            INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
            LEFT JOIN "TestRuns" tr ON tr.id = jts."testRunId"
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND rc."projectId" = ${projectIdNum}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" <= ${endDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              test_case_source,
              result_id,
              test_run_id,
              status_name,
              status_color,
              is_success,
              is_failure,
              executed_at,
              ROW_NUMBER() OVER (PARTITION BY test_case_id ORDER BY executed_at DESC) as row_num
            FROM combined_results
          )
          SELECT * FROM ranked_results WHERE row_num <= ${runs} ORDER BY test_case_id, row_num
        `;
      } else {
        rawResults = await prisma.$queryRaw<RawExecutionResult[]>`
          WITH combined_results AS (
            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              trr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN trc."testRunId" ELSE NULL END as test_run_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            LEFT JOIN "TestRuns" tr ON tr.id = trc."testRunId"
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND rc."projectId" = ${projectIdNum}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              rc.source::text as test_case_source,
              jr.id as result_id,
              CASE WHEN tr."isDeleted" = false THEN jts."testRunId" ELSE NULL END as test_run_id,
              COALESCE(s.name, jr.type::text) as status_name,
              COALESCE(c.value,
                CASE jr.type
                  WHEN 'PASSED' THEN '#22c55e'
                  WHEN 'FAILURE' THEN '#ef4444'
                  WHEN 'ERROR' THEN '#f97316'
                  ELSE '#6b7280'
                END
              ) as status_color,
              COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
              COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure,
              jr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
            INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
            LEFT JOIN "TestRuns" tr ON tr.id = jts."testRunId"
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              ${sourceFilterSql}
              AND rc."projectId" = ${projectIdNum}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              test_case_source,
              result_id,
              test_run_id,
              status_name,
              status_color,
              is_success,
              is_failure,
              executed_at,
              ROW_NUMBER() OVER (PARTITION BY test_case_id ORDER BY executed_at DESC) as row_num
            FROM combined_results
          )
          SELECT * FROM ranked_results WHERE row_num <= ${runs} ORDER BY test_case_id, row_num
        `;
      }
    }

    // Group results by test case (and project if included)
    const testCaseMap = new Map<string, {
      testCaseId: number;
      testCaseName: string;
      testCaseSource: string;
      projectId?: number;
      projectName?: string;
      executions: ExecutionStatus[];
    }>();

    for (const row of rawResults) {
      const testCaseId = row.test_case_id;
      // Create a unique key that includes project if it's included
      const key = includeProject && row.project_id
        ? `${testCaseId}-${row.project_id}`
        : `${testCaseId}`;

      if (!testCaseMap.has(key)) {
        testCaseMap.set(key, {
          testCaseId,
          testCaseName: row.test_case_name,
          testCaseSource: row.test_case_source,
      projectId: includeProject ? row.project_id : undefined,
      projectName: includeProject ? row.project_name : undefined,
          executions: [],
        });
      }

      testCaseMap.get(key)!.executions.push({
        resultId: row.result_id,
        testRunId: row.test_run_id,
        statusName: row.status_name,
        statusColor: row.status_color,
        isSuccess: row.is_success,
        isFailure: row.is_failure,
        executedAt: row.executed_at.toISOString(),
      });
    }

    // Process each test case to find flaky ones
    const flakyTests: FlakyTestRow[] = [];

    for (const testCase of testCaseMap.values()) {
      // Skip if not enough results
      if (testCase.executions.length < 2) {
        continue;
      }

      // Check if test has both success and failure results
      if (!hasRequiredFlakiness(testCase.executions)) {
        continue;
      }

      // Count flips
      const flipCount = countStatusFlips(testCase.executions);

      // Include if flip count meets threshold
      if (flipCount >= threshold) {
        flakyTests.push({
          testCaseId: testCase.testCaseId,
          testCaseName: testCase.testCaseName,
          testCaseSource: testCase.testCaseSource,
          flipCount,
          executions: testCase.executions,
          project: includeProject && testCase.projectId
            ? {
                id: testCase.projectId,
                name: testCase.projectName,
              }
            : undefined,
        });
      }
    }

    // Sort by flip count descending
    flakyTests.sort((a, b) => b.flipCount - a.flipCount);

    return Response.json({
      data: flakyTests,
      total: flakyTests.length,
      consecutiveRuns: runs,
      flipThreshold: threshold,
    });
  } catch (e: unknown) {
    console.error("Flaky tests report error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
