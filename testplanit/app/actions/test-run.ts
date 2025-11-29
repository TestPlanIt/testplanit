"use server";

import { prisma } from "~/lib/prisma";
import { revalidatePath } from "next/cache";
import { getServerAuthSession } from "~/server/auth";

// Define a new response type for getMaxOrderInTestRun
export type GetMaxOrderResponse =
  | { success: true; data: number }
  | { success: false; error: string; data: number };

/**
 * Gets the maximum order value for cases in a specific test run.
 * @param testRunId - ID of the test run
 * @returns The maximum order value, or 0 if no cases exist or have an order.
 */
export async function getMaxOrderInTestRun(
  testRunId: number
): Promise<GetMaxOrderResponse> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "User not authenticated", data: 0 };
  }

  try {
    const maxOrderResult = await prisma.testRunCases.aggregate({
      where: { testRunId },
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
 */
export async function addToTestRun(
  testRunId: number,
  repositoryCaseId: number,
  order: number // Added order parameter
) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "User not authenticated" };
  }

  try {
    // Create the new test run case with the provided order
    const result = await prisma.testRunCases.create({
      data: {
        testRunId,
        repositoryCaseId,
        order, // Use the provided order
      },
    });

    // Revalidate related paths to ensure UI is updated
    revalidatePath(`/projects/runs/${testRunId}`);

    return { success: true, data: result };
  } catch (error) {
    console.error("Error adding test case to test run:", error);
    return { success: false, error: "Failed to add test case to test run" };
  }
}
