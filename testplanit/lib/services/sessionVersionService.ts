import type { TxClient } from "~/lib/zenstack";

export interface SessionVersionOptions {
  /** Increment Sessions.currentVersion first and snapshot at the new number. */
  bumpVersion?: boolean;
  /** Who made the change the version records. */
  actor: { id: string; name?: string | null };
}

/**
 * Snapshot a session as it now stands into SessionVersions, at its
 * currentVersion — the history the web UI writes on create, edit and
 * complete. Built from the database rather than a client form, so API
 * clients (the MCP server) record the same snapshot the UI does.
 *
 * Tags, issues and attachments are stored the way the UI stores them: JSON
 * strings of `{id, name}`, `{id, name, externalId}` and the attachment rows
 * (size as a string, createdAt as ISO).
 */
export async function createSessionVersionInTransaction(
  tx: TxClient,
  sessionId: number,
  options: SessionVersionOptions
): Promise<{ id: number; version: number }> {
  if (options.bumpVersion) {
    await tx.sessions.update({
      where: { id: sessionId },
      data: { currentVersion: { increment: 1 } },
    });
  }

  const session = await tx.sessions.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      name: true,
      projectId: true,
      project: { select: { name: true } },
      templateId: true,
      template: { select: { templateName: true } },
      configId: true,
      configuration: { select: { name: true } },
      milestoneId: true,
      milestone: { select: { name: true } },
      stateId: true,
      state: { select: { name: true } },
      assignedToId: true,
      assignedTo: { select: { name: true } },
      estimate: true,
      forecastManual: true,
      forecastAutomated: true,
      elapsed: true,
      note: true,
      mission: true,
      isCompleted: true,
      completedAt: true,
      currentVersion: true,
      tags: {
        where: { isDeleted: false },
        select: { id: true, name: true },
      },
      issues: {
        where: { isDeleted: false },
        select: { id: true, name: true, externalId: true },
      },
      attachments: { where: { isDeleted: false } },
    },
  });
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const version = await tx.sessionVersions.create({
    data: {
      session: { connect: { id: session.id } },
      project: { connect: { id: session.projectId } },
      name: session.name,
      staticProjectId: session.projectId,
      staticProjectName: session.project?.name || "Unknown Project",
      templateId: session.templateId,
      templateName: session.template?.templateName || "Unknown Template",
      configId: session.configId,
      configurationName: session.configuration?.name ?? null,
      milestoneId: session.milestoneId,
      milestoneName: session.milestone?.name ?? null,
      stateId: session.stateId,
      stateName: session.state?.name || "Unknown State",
      assignedToId: session.assignedToId,
      assignedToName: session.assignedTo?.name ?? null,
      createdById: options.actor.id,
      createdByName: options.actor.name || "Unknown User",
      estimate: session.estimate,
      forecastManual: session.forecastManual,
      forecastAutomated: session.forecastAutomated,
      elapsed: session.elapsed,
      note: session.note ?? undefined,
      mission: session.mission ?? undefined,
      isCompleted: session.isCompleted,
      completedAt: session.completedAt,
      version: session.currentVersion,
      tags: JSON.stringify(session.tags),
      issues: JSON.stringify(session.issues),
      attachments: JSON.stringify(
        session.attachments.map((att) => ({
          ...att,
          size: att.size.toString(),
          createdAt: att.createdAt.toISOString(),
        }))
      ),
    },
    select: { id: true, version: true },
  });
  return version;
}
