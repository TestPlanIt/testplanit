"use server";

import { prisma } from "~/lib/prisma";
import { NotificationService } from "~/lib/services/notificationService";
import { getServerAuthSession } from "~/server/auth";

export async function notifyTestCaseAssignment(
  testRunCaseId: number,
  newAssigneeId: string | null,
  previousAssigneeId?: string | null
) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return;
  }

  // Don't notify if assignment hasn't changed or if unassigning
  if (newAssigneeId === previousAssigneeId || !newAssigneeId) {
    return;
  }

  try {
    // Get test run case details with related information
    const testRunCase = await prisma.testRunCases.findUnique({
      where: { id: testRunCaseId },
      include: {
        repositoryCase: true,
        testRun: {
          include: {
            project: true,
          },
        },
      },
    });

    if (!testRunCase) {
      return;
    }

    // Get the assignee details
    const assignee = await prisma.user.findUnique({
      where: { id: newAssigneeId },
      select: { name: true },
    });

    // Create notification with additional data for links
    await NotificationService.createNotification({
      userId: newAssigneeId,
      type: "WORK_ASSIGNED" as any,
      title: "New Test Case Assignment",
      message: `${session.user.name || "Unknown User"} assigned you to test case "${testRunCase.repositoryCase.name}" in project "${testRunCase.testRun.project.name}"`,
      relatedEntityId: testRunCaseId.toString(),
      relatedEntityType: "TestRunCase",
      data: {
        assignedById: session.user.id,
        assignedByName: session.user.name || "Unknown User",
        projectId: testRunCase.testRun.project.id,
        projectName: testRunCase.testRun.project.name,
        testRunId: testRunCase.testRun.id,
        testRunName: testRunCase.testRun.name,
        testCaseId: testRunCase.repositoryCaseId,
        testCaseName: testRunCase.repositoryCase.name,
        entityName: testRunCase.repositoryCase.name,
      },
    });
  } catch (error) {
    console.error("Failed to create test case assignment notification:", error);
  }
}

export async function notifyBulkTestCaseAssignment(
  testRunCaseIds: number[],
  newAssigneeId: string | null,
  projectId: number
) {
  const session = await getServerAuthSession();
  if (!session?.user?.id || !newAssigneeId) {
    return;
  }

  try {
    // Get project details and test run cases with their test runs
    const testRunCases = await prisma.testRunCases.findMany({
      where: {
        id: { in: testRunCaseIds },
      },
      include: {
        testRun: {
          include: {
            project: true,
          },
        },
        repositoryCase: true,
      },
    });

    if (!testRunCases.length) {
      return;
    }

    // Group by test run for better notification structure
    const testRunGroups = testRunCases.reduce((acc, trc) => {
      const runId = trc.testRun.id;
      if (!acc[runId]) {
        acc[runId] = {
          testRunId: runId,
          testRunName: trc.testRun.name,
          projectId: trc.testRun.project.id,
          projectName: trc.testRun.project.name,
          testCases: [],
        };
      }
      acc[runId].testCases.push({
        testRunCaseId: trc.id,
        testCaseId: trc.repositoryCaseId,
        testCaseName: trc.repositoryCase.name,
      });
      return acc;
    }, {} as Record<number, any>);

    // Create a single notification for bulk assignment
    await NotificationService.createNotification({
      userId: newAssigneeId,
      type: "WORK_ASSIGNED" as any,
      title: "Multiple Test Cases Assigned",
      message: `${session.user.name || "Unknown User"} assigned you ${testRunCaseIds.length} test cases`,
      data: {
        assignedById: session.user.id,
        assignedByName: session.user.name || "Unknown User",
        testRunGroups: Object.values(testRunGroups),
        count: testRunCaseIds.length,
        isBulkAssignment: true,
      },
    });
  } catch (error) {
    console.error("Failed to create bulk assignment notification:", error);
  }
}