/**
 * Assignment notifications for every writer.
 *
 * The web UI used to send these from the browser after it wrote the
 * assignee, so a run case or session assigned through the MCP server, the
 * API client or a server action notified nobody. The side-effects plugin now
 * calls these after the write, with the actor taken from the audit context,
 * so the assignee hears about it whichever client made the assignment.
 */

import { NotificationService } from "~/lib/services/notificationService";

export interface AssignmentActor {
  id: string;
  name: string | null | undefined;
}

type AssignmentDb = {
  testRunCases: { findMany: (args: any) => Promise<any[]> };
  sessions: { findUnique: (args: any) => Promise<any> };
};

const actorName = (actor: AssignmentActor) => actor.name || "Unknown User";

/**
 * One notification per assignment batch: the single-case shape when one run
 * case changed hands, the bulk shape (grouped by run) when several did —
 * the same two shapes the web UI sent.
 */
export async function notifyRunCaseAssignment(
  db: AssignmentDb,
  args: {
    testRunCaseIds: number[];
    assignedToId: string;
    actor: AssignmentActor;
  }
): Promise<void> {
  if (args.testRunCaseIds.length === 0) return;
  const rows = await db.testRunCases.findMany({
    where: { id: { in: args.testRunCaseIds }, isDeleted: false },
    select: {
      id: true,
      repositoryCaseId: true,
      repositoryCase: { select: { name: true } },
      testRun: {
        select: {
          id: true,
          name: true,
          project: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (rows.length === 0) return;

  const byName = actorName(args.actor);
  if (rows.length === 1) {
    const trc = rows[0];
    await NotificationService.createNotification({
      userId: args.assignedToId,
      type: "WORK_ASSIGNED" as any,
      title: "New Test Case Assignment",
      message: `${byName} assigned you to test case "${trc.repositoryCase.name}" in project "${trc.testRun.project.name}"`,
      relatedEntityId: String(trc.id),
      relatedEntityType: "TestRunCase",
      data: {
        assignedById: args.actor.id,
        assignedByName: byName,
        projectId: trc.testRun.project.id,
        projectName: trc.testRun.project.name,
        testRunId: trc.testRun.id,
        testRunName: trc.testRun.name,
        testCaseId: trc.repositoryCaseId,
        testCaseName: trc.repositoryCase.name,
        entityName: trc.repositoryCase.name,
      },
    });
    return;
  }

  const groups = new Map<
    number,
    {
      testRunId: number;
      testRunName: string;
      projectId: number;
      projectName: string;
      testCases: Array<{
        testRunCaseId: number;
        testCaseId: number;
        testCaseName: string;
      }>;
    }
  >();
  for (const trc of rows) {
    let group = groups.get(trc.testRun.id);
    if (!group) {
      group = {
        testRunId: trc.testRun.id,
        testRunName: trc.testRun.name,
        projectId: trc.testRun.project.id,
        projectName: trc.testRun.project.name,
        testCases: [],
      };
      groups.set(trc.testRun.id, group);
    }
    group.testCases.push({
      testRunCaseId: trc.id,
      testCaseId: trc.repositoryCaseId,
      testCaseName: trc.repositoryCase.name,
    });
  }
  await NotificationService.createNotification({
    userId: args.assignedToId,
    type: "WORK_ASSIGNED" as any,
    title: "Multiple Test Cases Assigned",
    message: `${byName} assigned you ${rows.length} test cases`,
    data: {
      assignedById: args.actor.id,
      assignedByName: byName,
      testRunGroups: Array.from(groups.values()),
      count: rows.length,
      isBulkAssignment: true,
    },
  });
}

export async function notifySessionAssignment(
  db: AssignmentDb,
  args: { sessionId: number; assignedToId: string; actor: AssignmentActor }
): Promise<void> {
  const session = await db.sessions.findUnique({
    where: { id: args.sessionId },
    select: {
      id: true,
      name: true,
      project: { select: { id: true, name: true } },
    },
  });
  if (!session) return;
  const byName = actorName(args.actor);
  await NotificationService.createNotification({
    userId: args.assignedToId,
    type: "SESSION_ASSIGNED" as any,
    title: "New Session Assignment",
    message: `${byName} assigned you to session "${session.name}" in project "${session.project.name}"`,
    relatedEntityId: String(session.id),
    relatedEntityType: "Session",
    data: {
      assignedById: args.actor.id,
      assignedByName: byName,
      projectId: session.project.id,
      projectName: session.project.name,
      sessionId: session.id,
      sessionName: session.name,
      entityName: session.name,
    },
  });
}
