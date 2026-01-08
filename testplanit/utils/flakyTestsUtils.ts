import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";

interface ExecutionStatus {
  resultId: number;
  statusName: string;
  statusColor: string;
  isSuccess: boolean;
  isFailure: boolean;
  executedAt: string;
}

interface FlakyTestRow {
  testCaseId: number;
  testCaseName: string;
  flipCount: number;
  executions: ExecutionStatus[];
}

interface RawExecutionResult {
  test_case_id: number;
  test_case_name: string;
  result_id: number;
  status_name: string;
  status_color: string;
  is_success: boolean;
  is_failure: boolean;
  executed_at: Date;
  row_num: bigint;
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
    } = body;

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

    // Use raw SQL with window functions to efficiently get recent results per test case
    // Build query based on whether it's cross-project and date filters
    let rawResults: RawExecutionResult[];

    if (isCrossProject) {
      if (startDateParsed && endDateParsed) {
        rawResults = await prisma.$queryRaw<RawExecutionResult[]>`
          WITH combined_results AS (
            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              trr.id as result_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND trr."executedAt" >= ${startDateParsed}
              AND trr."executedAt" <= ${endDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              jr.id as result_id,
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
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" >= ${startDateParsed}
              AND jr."executedAt" <= ${endDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              result_id,
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
              trr.id as result_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND trr."executedAt" >= ${startDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              jr.id as result_id,
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
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" >= ${startDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              result_id,
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
              trr.id as result_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND trr."executedAt" <= ${endDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              jr.id as result_id,
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
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" <= ${endDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              result_id,
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
              trr.id as result_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              jr.id as result_id,
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
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              result_id,
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
    } else {
      // Project-specific queries
      if (startDateParsed && endDateParsed) {
        rawResults = await prisma.$queryRaw<RawExecutionResult[]>`
          WITH combined_results AS (
            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              trr.id as result_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND rc."projectId" = ${projectIdNum}
              AND trr."executedAt" >= ${startDateParsed}
              AND trr."executedAt" <= ${endDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              jr.id as result_id,
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
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
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
              result_id,
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
              trr.id as result_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND rc."projectId" = ${projectIdNum}
              AND trr."executedAt" >= ${startDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              jr.id as result_id,
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
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND rc."projectId" = ${projectIdNum}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" >= ${startDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              result_id,
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
              trr.id as result_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND rc."projectId" = ${projectIdNum}
              AND trr."executedAt" <= ${endDateParsed}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              jr.id as result_id,
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
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND rc."projectId" = ${projectIdNum}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
              AND jr."executedAt" <= ${endDateParsed}
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              result_id,
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
              trr.id as result_id,
              s.name as status_name,
              c.value as status_color,
              s."isSuccess" as is_success,
              s."isFailure" as is_failure,
              trr."executedAt" as executed_at
            FROM "RepositoryCases" rc
            INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
            INNER JOIN "TestRuns" tr ON tr.id = trc."testRunId" AND tr."isDeleted" = false
            INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
            INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" != 'untested'
            INNER JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND rc."projectId" = ${projectIdNum}

            UNION ALL

            SELECT
              rc.id as test_case_id,
              rc.name as test_case_name,
              jr.id as result_id,
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
            LEFT JOIN "Status" s ON s.id = jr."statusId"
            LEFT JOIN "Color" c ON c.id = s."colorId"
            WHERE rc."isDeleted" = false
              AND rc."projectId" = ${projectIdNum}
              AND jr.type != 'SKIPPED'
              AND jr."executedAt" IS NOT NULL
          ),
          ranked_results AS (
            SELECT
              test_case_id,
              test_case_name,
              result_id,
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

    // Group results by test case
    const testCaseMap = new Map<number, {
      testCaseId: number;
      testCaseName: string;
      executions: ExecutionStatus[];
    }>();

    for (const row of rawResults) {
      const testCaseId = row.test_case_id;

      if (!testCaseMap.has(testCaseId)) {
        testCaseMap.set(testCaseId, {
          testCaseId,
          testCaseName: row.test_case_name,
          executions: [],
        });
      }

      testCaseMap.get(testCaseId)!.executions.push({
        resultId: row.result_id,
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
          flipCount,
          executions: testCase.executions,
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
