"use server";

import { revalidatePath } from "next/cache";
import { withActionAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { getServerAuthSession } from "~/server/auth";

// Define a new response type for getMaxOrderInTestRun
export type GetMaxOrderResponse =
  | { success: true; data: number }
  | { success: false; error: string; data: number };

/**
 * Gets the maximum order value for cases in a specific test run.
 * @param testRunId - ID of the test run
 * @returns The maximum order value, or 0 if no cases exist or have an order.
 *
 * NOT wrapped in withActionAuditContext — read-only aggregate, emits
 * no audit events.
 */
export async function getMaxOrderInTestRun(
  testRunId: number
): Promise<GetMaxOrderResponse> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "User not authenticated", data: 0 };
  }

  try {
    const maxOrderResult = await baseDb.testRunCases.aggregate({
      where: { testRunId, isDeleted: false },
      _max: { order: true },
    });
    return { success: true, data: maxOrderResult._max.order ?? 0 };
  } catch (error) {
    console.error("Error getting max order in test run:", error);
    return { success: false, error: "Failed to get max order", data: 0 };
  }
}

/**
 * Adds a test case to a test run with a specified order.
 * @param testRunId - ID of the test run
 * @param repositoryCaseId - ID of the repository case to add
 * @param order - The order for the new test case
 * @returns The created test run case
 *
 * Wrapped in withActionAuditContext: the
 * baseDb.testRunCases.create call below triggers the TestRunCases
 * extension hook at lib/baseDb.ts:1060 which emits auditCreate(
 * "TestRunCases", result). Without the wrapper that audit row would
 * have null ipAddress/userAgent/requestId; with the wrapper plus the
 * NextAuth session callback enrichment (Plan 01 Task 3) triggered by
 * getServerAuthSession below, the row carries complete actor context
 */
export const addToTestRun = withActionAuditContext(
  async (testRunId: number, repositoryCaseId: number, order: number) => {
    const session = await getServerAuthSession();
    if (!session?.user?.id) {
      return { success: false, error: "User not authenticated" } as const;
    }

    try {
      const result = await baseDb.testRunCases.upsert({
        where: {
          testRunId_repositoryCaseId: { testRunId, repositoryCaseId },
        },
        create: {
          testRunId,
          repositoryCaseId,
          order,
        },
        update: {
          isDeleted: false,
          order,
        },
      });

      // Revalidate related paths to ensure UI is updated
      revalidatePath(`/projects/runs/${testRunId}`);

      return { success: true, data: result } as const;
    } catch (error) {
      console.error("Error adding test case to test run:", error);
      return {
        success: false,
        error: "Failed to add test case to test run",
      } as const;
    }
  }
);
