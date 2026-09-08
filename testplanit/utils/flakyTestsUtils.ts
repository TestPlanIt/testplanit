import { NextRequest } from "next/server";
import { authorizeReportRequest } from "~/utils/reportApiUtils";
import {
  queryLatestTestResults,
  type RawExecutionResult,
} from "~/lib/services/latestTestResults";

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
  testCaseHasParameters: boolean;
  flipCount: number;
  executions: ExecutionStatus[];
  project?: {
    id: number;
    name?: string;
  };
}

/**
 * Count the number of status flips (transitions between different status types) in a sequence of executions.
 * Counts transitions between:
 * - Success (isSuccess = true) and any non-success (isSuccess = false)
 * - This includes transitions to Failed, Blocked, Retest, Skipped, etc.
 * Results are compared based on whether they are success or not, capturing all status changes.
 */
export function countStatusFlips(executions: ExecutionStatus[]): number {
  let flips = 0;
  let lastIsSuccess: boolean | null = null;

  for (const execution of executions) {
    const currentIsSuccess = execution.isSuccess;

    // If we have a previous result and it differs from current (success <-> non-success), count as flip
    if (lastIsSuccess !== null && currentIsSuccess !== lastIsSuccess) {
      flips++;
    }

    lastIsSuccess = currentIsSuccess;
  }

  return flips;
}

/**
 * Check if a test case qualifies as flaky based on its execution history.
 * A test is flaky if it has:
 * 1. Both success and failure results (traditional flakiness), OR
 * 2. Any non-success results (including Blocked, Retest, Skipped, etc.) - to show tests with other statuses
 */
function hasRequiredFlakiness(executions: ExecutionStatus[]): boolean {
  let hasSuccess = false;
  let hasFailure = false;
  let hasNonSuccess = false;

  for (const execution of executions) {
    if (execution.isSuccess) {
      hasSuccess = true;
    } else {
      // Any result that is not a success (including failures, blocked, retest, skipped, etc.)
      hasNonSuccess = true;
    }
    if (execution.isFailure) hasFailure = true;

    // Return true if we have both success and failure (traditional flakiness)
    if (hasSuccess && hasFailure) return true;
  }

  // Also return true if we have both success and any non-success result
  // This includes tests with Blocked, Retest, Skipped, etc. statuses
  return hasSuccess && hasNonSuccess;
}

export async function handleFlakyTestsPOST(
  req: NextRequest,
  isCrossProject: boolean
) {
  try {
    const body = await req.json();

    const authz = await authorizeReportRequest(req, {
      requiresAdmin: isCrossProject,
      projectId: body?.projectId ? Number(body.projectId) : undefined,
    });
    if (!authz.ok) return authz.response;
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

    // "Automated" means the case's `automated` flag — the definitive
    // marker (reporters flip it) — not the source enum, which records where
    // the case came from.
    const automatedFlag =
      automatedFilter === "automated"
        ? true
        : automatedFilter === "manual"
          ? false
          : null; // null means no filter (show all)

    // Ranked executions come from the shared service, which composes the
    // date/flag/project filters into one statement.
    const rawResults: RawExecutionResult[] = await queryLatestTestResults({
      limit: runs,
      projectId: isCrossProject ? null : projectIdNum,
      startDate: startDateParsed,
      endDate: endDateParsed,
      automatedFlag,
      includeProject,
    });

    // Group results by test case (and project if included)
    const testCaseMap = new Map<
      string,
      {
        testCaseId: number;
        testCaseName: string;
        testCaseSource: string;
        testCaseHasParameters: boolean;
        projectId?: number;
        projectName?: string;
        executions: ExecutionStatus[];
      }
    >();

    for (const row of rawResults) {
      const testCaseId = row.test_case_id;
      // Create a unique key that includes project if it's included
      const key =
        includeProject && row.project_id
          ? `${testCaseId}-${row.project_id}`
          : `${testCaseId}`;

      if (!testCaseMap.has(key)) {
        testCaseMap.set(key, {
          testCaseId,
          testCaseName: row.test_case_name,
          testCaseSource: row.test_case_source,
          testCaseHasParameters: row.test_case_has_parameters,
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
          testCaseHasParameters: testCase.testCaseHasParameters,
          flipCount,
          executions: testCase.executions,
          project:
            includeProject && testCase.projectId
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
