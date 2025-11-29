"use server";

import { prisma } from "~/lib/prisma";
import { NotificationService } from "~/lib/services/notificationService";
import { getServerAuthSession } from "~/server/auth";

export async function notifySessionAssignment(
  sessionId: number,
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
    // Get session details with related information
    const sessionData = await prisma.sessions.findUnique({
      where: { id: sessionId },
      include: {
        project: true,
      },
    });

    if (!sessionData) {
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
      type: "SESSION_ASSIGNED" as any,
      title: "New Session Assignment",
      message: `${session.user.name || "Unknown User"} assigned you to session "${sessionData.name}" in project "${sessionData.project.name}"`,
      relatedEntityId: sessionId.toString(),
      relatedEntityType: "Session",
      data: {
        assignedById: session.user.id,
        assignedByName: session.user.name || "Unknown User",
        projectId: sessionData.project.id,
        projectName: sessionData.project.name,
        sessionId: sessionId,
        sessionName: sessionData.name,
        entityName: sessionData.name,
      },
    });
  } catch (error) {
    console.error("Failed to create session assignment notification:", error);
  }
}