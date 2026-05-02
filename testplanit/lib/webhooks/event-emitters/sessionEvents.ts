import type { Prisma } from "@prisma/client";

import { webhookEvents } from "~/lib/webhooks/events";

/**
 * Emit per-mutation outbound webhook events for Sessions lifecycle.
 * Mirrors testRunEvents 1:1 except:
 *  - session.completed payload is minimal – no getSessionSummary equivalent
 *    exists
 *  - emitSessionDuplicated is exported but NOT called from the $extends
 *    middleware — needs a duplicatedFrom marker).
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

  // Two INDEPENDENT lifecycle transitions on Sessions. Either, both, or
  // neither can fire. isCompleted is the canonical "this session is done"
  // signal — admins can mark a session completed without changing stateId,
  // and conversely.
  const stateChanged = oldRow.stateId !== newRow.stateId;
  const completedTransition =
    oldRow.isCompleted !== true && newRow.isCompleted === true;
  if (!stateChanged && !completedTransition) return;

  if (stateChanged) {
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

    await webhookEvents.emit(
      "session.state_changed",
      {
        sessionId: newRow.id,
        sessionName: newRow.name,
        projectId: newRow.projectId,
        from: {
          stateId: oldRow.stateId,
          stateName: fromState?.name ?? null,
          isCompleted: oldRow.isCompleted === true,
        },
        to: {
          stateId: newRow.stateId,
          stateName: toState?.name ?? null,
          isCompleted: newRow.isCompleted === true,
        },
        isCompletedTransition: completedTransition,
      },
      {
        projectId: opts.projectId ?? newRow.projectId,
        tx,
        actorUserId: opts.actorUserId,
      }
    );
  }

  if (completedTransition) {
    // Session payload mirrors what SessionResultsSummary.tsx renders:
    // results (NOT cases), per-result statuses, total elapsed time.
    // Sessions don't have a "completion %" — exploratory testing ends
    // when the tester decides it's done, not when N cases are checked off.
    const results = await tx.sessionResults.findMany({
      where: { sessionId: newRow.id, isDeleted: false },
      select: {
        elapsed: true,
        statusId: true,
        status: {
          select: {
            id: true,
            name: true,
            isCompleted: true,
            isSuccess: true,
            isFailure: true,
            color: { select: { value: true } },
          },
        },
      },
    });

    const totalResults = results.length;
    const totalElapsed = results.reduce((sum, r) => sum + (r.elapsed ?? 0), 0);

    // Group by statusId for breakdown rendering.
    const statusCountsMap = new Map<
      number,
      {
        statusId: number;
        statusName: string;
        colorValue: string | null;
        count: number;
        isCompleted: boolean;
        isSuccess: boolean;
        isFailure: boolean;
      }
    >();
    for (const r of results) {
      const existing = statusCountsMap.get(r.statusId);
      if (existing) {
        existing.count += 1;
      } else {
        statusCountsMap.set(r.statusId, {
          statusId: r.statusId,
          statusName: r.status?.name ?? "Unknown",
          colorValue: r.status?.color?.value ?? null,
          count: 1,
          isCompleted: r.status?.isCompleted ?? false,
          isSuccess: r.status?.isSuccess ?? false,
          isFailure: r.status?.isFailure ?? false,
        });
      }
    }
    const statusCounts = Array.from(statusCountsMap.values());

    await webhookEvents.emit(
      "session.completed",
      {
        sessionId: newRow.id,
        sessionTitle: newRow.name,
        projectId: newRow.projectId,
        totalResults,
        totalElapsed, // seconds
        statusCounts,
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
