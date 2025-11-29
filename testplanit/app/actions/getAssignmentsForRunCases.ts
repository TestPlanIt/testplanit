"use server";

import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";
import { z } from "zod/v4";

// Define the input schema using Zod
const GetAssignmentsInputSchema = z.object({
  originalRunId: z.number(),
  repositoryCaseIds: z.array(z.number()),
});

// Define the expected success output structure
type SuccessResponse = {
  success: true;
  data: {
    repositoryCaseId: number;
    userId: string | null;
  }[];
};

// Define the expected error output structure
type ErrorResponse = {
  success: false;
  error: string;
  issues?: z.ZodIssue[];
  data: []; // Ensure data is always an empty array on error for consistency
};

export type GetAssignmentsResponse = SuccessResponse | ErrorResponse;

export async function getAssignmentsForRunCases(
  input: z.infer<typeof GetAssignmentsInputSchema>
): Promise<GetAssignmentsResponse> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "User not authenticated", data: [] };
  }

  const validation = GetAssignmentsInputSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: "Invalid input",
      issues: validation.error.issues,
      data: [],
    };
  }

  const { originalRunId, repositoryCaseIds } = validation.data;

  try {
    const assignments = await prisma.testRunCases.findMany({
      where: {
        testRunId: originalRunId,
        repositoryCaseId: {
          in: repositoryCaseIds,
        },
      },
      select: {
        repositoryCaseId: true,
        assignedToId: true,
      },
    });

    return {
      success: true,
      data: assignments.map((a) => ({
        repositoryCaseId: a.repositoryCaseId,
        userId: a.assignedToId,
      })),
    };
  } catch (error) {
    console.error("Error fetching assignments for run cases:", error);
    return { success: false, error: "Failed to fetch assignments", data: [] };
  }
}

// The type for the data part of a successful response, if needed externally
export type AssignmentsForRunCasesData = SuccessResponse["data"];
