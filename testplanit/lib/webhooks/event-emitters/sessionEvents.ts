import type { Prisma } from "@prisma/client";

import { webhookEvents } from "~/lib/webhooks/events";

/**
 * D-10 / OUT-11..14 (sessions parallel) — emit per-mutation outbound webhook
 * events for Sessions lifecycle. Mirrors testRunEvents 1:1 except:
 *  - session.completed payload is minimal (no getSessionSummary equivalent
 *    exists; documented as a Phase 2 follow-up asymmetry)
 *  - emitSessionDuplicated is exported but NOT called from the $extends
 *    middleware in Phase 2 (Sync Point #2 — needs a duplicatedFrom marker).
 */

export interface SessionRow {
  id: number;
  projectId: number;
  name: string;
  stateId: number | null;
  isCompleted?: boolean;
}

interface EmitOptions {
  projectId?: number;
  actorUserId?: string | null;
}

export async function emitSessionCreated(
  row: SessionRow,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  let stateName: string | null = null;
  let stateIsCompleted = false;
  if (row.stateId != null) {
    const state = await tx.workflows.findUnique({
      where: { id: row.stateId },
      select: { name: true, workflowType: true },
    });
    stateName = state?.name ?? null;
    stateIsCompleted = state?.workflowType === "DONE";
  }
  await webhookEvents.emit(
    "session.created",
    {
      sessionId: row.id,
      sessionName: row.name,
      projectId: row.projectId,
      stateId: row.stateId,
      stateName,
      isCompleted: stateIsCompleted,
    },
    {
      projectId: opts.projectId ?? row.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}

export async function emitSessionUpdateEvents(
  oldRow: SessionRow | null,
  newRow: SessionRow,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  if (!oldRow) return;
  const stateChanged = oldRow.stateId !== newRow.stateId;
  if (!stateChanged) return;

  const [fromState, toState] = await Promise.all([
    oldRow.stateId != null
      ? tx.workflows.findUnique({
          where: { id: oldRow.stateId },
          select: { name: true, workflowType: true },
        })
      : Promise.resolve(null),
    newRow.stateId != null
      ? tx.workflows.findUnique({
          where: { id: newRow.stateId },
          select: { name: true, workflowType: true },
        })
      : Promise.resolve(null),
  ]);
  const fromCompleted = fromState?.workflowType === "DONE";
  const toCompleted = toState?.workflowType === "DONE";
  const isCompletedTransition = toCompleted === true && fromCompleted === false;

  await webhookEvents.emit(
    "session.state_changed",
    {
      sessionId: newRow.id,
      sessionName: newRow.name,
      projectId: newRow.projectId,
      from: {
        stateId: oldRow.stateId,
        stateName: fromState?.name ?? null,
        isCompleted: fromCompleted,
      },
      to: {
        stateId: newRow.stateId,
        stateName: toState?.name ?? null,
        isCompleted: toCompleted,
      },
      isCompletedTransition,
    },
    {
      projectId: opts.projectId ?? newRow.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );

  if (isCompletedTransition) {
    // session-summary asymmetry: there's no getSessionSummary equivalent in
    // the codebase yet, so we emit a minimal payload. A Phase 2+ follow-up
    // can extract a service module analogous to lib/services/testRunSummary.
    const totalCases = await tx.sessionResults.count({
      where: { sessionId: newRow.id, isDeleted: false },
    });
    await webhookEvents.emit(
      "session.completed",
      {
        sessionId: newRow.id,
        sessionName: newRow.name,
        projectId: newRow.projectId,
        totalCases,
      },
      {
        projectId: opts.projectId ?? newRow.projectId,
        tx,
        actorUserId: opts.actorUserId,
      }
    );
  }
}

export interface SessionResultRow {
  id: number;
  sessionId: number;
  statusId: number;
  createdById?: string | null;
  createdAt?: Date | null;
}

export async function emitSessionResultAdded(
  row: SessionResultRow,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  const [session, status] = await Promise.all([
    tx.sessions.findUnique({
      where: { id: row.sessionId },
      select: { id: true, name: true, projectId: true },
    }),
    row.statusId != null
      ? tx.status.findUnique({
          where: { id: row.statusId },
          select: { id: true, name: true, isCompleted: true },
        })
      : Promise.resolve(null),
  ]);
  if (!session) return;
  await webhookEvents.emit(
    "session.result_added",
    {
      sessionId: session.id,
      sessionName: session.name,
      resultId: row.id,
      statusId: status?.id ?? null,
      statusName: status?.name ?? null,
      isCompleted: status?.isCompleted ?? false,
      executedById: row.createdById ?? null,
      executedAt: row.createdAt?.toISOString() ?? null,
    },
    {
      projectId: opts.projectId ?? session.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}

export async function emitSessionDuplicated(
  newSessionId: number,
  sourceSessionId: number,
  tx: Prisma.TransactionClient,
  opts: EmitOptions & { projectId: number }
): Promise<void> {
  const newSession = await tx.sessions.findUnique({
    where: { id: newSessionId },
    select: { id: true, name: true, projectId: true },
  });
  if (!newSession) return;
  await webhookEvents.emit(
    "session.duplicated",
    {
      newSessionId: newSession.id,
      sourceSessionId,
      sessionName: newSession.name,
      projectId: newSession.projectId,
    },
    {
      projectId: opts.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}
