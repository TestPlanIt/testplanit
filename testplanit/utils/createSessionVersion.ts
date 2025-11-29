import { Session } from "next-auth";
import { CompletableSession } from "@/projects/sessions/[projectId]/[sessionId]/CompleteSessionDialog";

interface CreateSessionVersionParams {
  sessionId: number;
  projectId: number;
  sessionData: CompletableSession;
  version: number;
  session: Session;
  isCompleted?: boolean;
  completedAt?: Date | null;
}

export async function createSessionVersion({
  sessionId,
  projectId,
  sessionData,
  version,
  session,
  isCompleted,
  completedAt,
}: CreateSessionVersionParams) {
  return {
    data: {
      session: {
        connect: { id: Number(sessionId) },
      },
      name: sessionData.name,
      staticProjectId: Number(projectId),
      staticProjectName: sessionData.project?.name || "Unknown Project",
      project: {
        connect: { id: Number(projectId) },
      },
      templateId: sessionData.templateId,
      templateName: sessionData.template?.templateName || "",
      configId: sessionData.configId || null,
      configurationName: sessionData.configuration?.name || null,
      milestoneId: sessionData.milestoneId || null,
      milestoneName: sessionData.milestone?.name || null,
      stateId: sessionData.stateId,
      stateName: sessionData.state?.name || "",
      assignedToId: sessionData.assignedToId || null,
      assignedToName: sessionData.assignedTo?.name || null,
      createdById: session.user.id,
      createdByName: session.user.name || "Unknown User",
      estimate: sessionData.estimate,
      forecastManual: null,
      forecastAutomated: null,
      elapsed: sessionData.elapsed,
      note: JSON.stringify(sessionData.note),
      mission: JSON.stringify(sessionData.mission),
      isCompleted: isCompleted ?? false,
      completedAt: completedAt ?? null,
      version: version,
      tags: sessionData.tags,
      attachments: sessionData.attachments,
    },
  };
}
