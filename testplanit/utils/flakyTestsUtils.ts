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
 * Map JUnit result type to success/failure flags and default colors
 */
function mapJUnitResultType(type: string): {
  isSuccess: boolean;
  isFailure: boolean;
  statusName: string;
  defaultColor: string;
} {
  switch (type) {
    case "PASSED":
      return {
        isSuccess: true,
        isFailure: false,
        statusName: "Passed",
        defaultColor: "#22c55e", // green
      };
    case "FAILURE":
      return {
        isSuccess: false,
        isFailure: true,
        statusName: "Failed",
        defaultColor: "#ef4444", // red
      };
    case "ERROR":
      return {
        isSuccess: false,
        isFailure: true,
        statusName: "Error",
        defaultColor: "#f97316", // orange
      };
    default:
      // SKIPPED or unknown - not definitive
      return {
        isSuccess: false,
        isFailure: false,
        statusName: type,
        defaultColor: "#6b7280", // gray
      };
  }
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

    // Build date filter for executions
    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate);
    }

    // Build base where clause for test cases
    const baseWhere: any = {
      isDeleted: false,
    };

    if (!isCrossProject) {
      baseWhere.projectId = Number(projectId);
    }

    // Query all test cases with their recent test run results AND JUnit results
    // We need to get results across all test run cases for each repository case
    const testCases = await prisma.repositoryCases.findMany({
      where: baseWhere,
      select: {
        id: true,
        name: true,
        // Manual test run results
        testRuns: {
          where: {
            testRun: {
              isDeleted: false,
            },
          },
          select: {
            results: {
              where: {
                isDeleted: false,
                // Exclude untested status
                status: {
                  systemName: {
                    not: "untested",
                  },
                },
                ...(Object.keys(dateFilter).length > 0
                  ? { executedAt: dateFilter }
                  : {}),
              },
              orderBy: {
                executedAt: "desc",
              },
              select: {
                id: true,
                executedAt: true,
                status: {
                  select: {
                    name: true,
                    isSuccess: true,
                    isFailure: true,
                    color: {
                      select: {
                        value: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        // JUnit automated test results
        junitResults: {
          where: {
            // Exclude SKIPPED results (similar to excluding untested)
            type: {
              not: "SKIPPED",
            },
            ...(Object.keys(dateFilter).length > 0
              ? { executedAt: dateFilter }
              : {}),
          },
          orderBy: {
            executedAt: "desc",
          },
          select: {
            id: true,
            executedAt: true,
            type: true,
            status: {
              select: {
                name: true,
                isSuccess: true,
                isFailure: true,
                color: {
                  select: {
                    value: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Process each test case to find flaky ones
    const flakyTests: FlakyTestRow[] = [];

    for (const testCase of testCases) {
      // Collect all results from both manual test runs and JUnit results
      const allExecutions: ExecutionStatus[] = [];

      // Add manual test run results
      for (const testRunCase of testCase.testRuns) {
        for (const result of testRunCase.results) {
          allExecutions.push({
            resultId: result.id,
            statusName: result.status.name,
            statusColor: result.status.color.value,
            isSuccess: result.status.isSuccess,
            isFailure: result.status.isFailure,
            executedAt: result.executedAt.toISOString(),
          });
        }
      }

      // Add JUnit automated test results
      for (const junitResult of testCase.junitResults) {
        // Skip results without executedAt (shouldn't happen, but be safe)
        if (!junitResult.executedAt) continue;

        const junitMapping = mapJUnitResultType(junitResult.type);

        // Use linked status if available, otherwise use JUnit type mapping
        if (junitResult.status) {
          allExecutions.push({
            resultId: junitResult.id,
            statusName: junitResult.status.name,
            statusColor: junitResult.status.color?.value || junitMapping.defaultColor,
            isSuccess: junitResult.status.isSuccess,
            isFailure: junitResult.status.isFailure,
            executedAt: junitResult.executedAt.toISOString(),
          });
        } else {
          // No linked status - use JUnit result type directly
          allExecutions.push({
            resultId: junitResult.id,
            statusName: junitMapping.statusName,
            statusColor: junitMapping.defaultColor,
            isSuccess: junitMapping.isSuccess,
            isFailure: junitMapping.isFailure,
            executedAt: junitResult.executedAt.toISOString(),
          });
        }
      }

      // Sort by executedAt descending (most recent first)
      allExecutions.sort(
        (a, b) =>
          new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()
      );

      // Take only the last N results
      const recentExecutions = allExecutions.slice(0, runs);

      // Skip if not enough results
      if (recentExecutions.length < 2) {
        continue;
      }

      // Check if test has both success and failure results
      if (!hasRequiredFlakiness(recentExecutions)) {
        continue;
      }

      // Count flips
      const flipCount = countStatusFlips(recentExecutions);

      // Include if flip count meets threshold
      if (flipCount >= threshold) {
        flakyTests.push({
          testCaseId: testCase.id,
          testCaseName: testCase.name,
          flipCount,
          executions: recentExecutions,
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
