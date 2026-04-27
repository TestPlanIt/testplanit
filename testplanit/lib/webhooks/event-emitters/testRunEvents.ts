import type { Prisma } from "@prisma/client";

import { getTestRunSummary } from "~/lib/services/testRunSummary";
import { webhookEvents } from "~/lib/webhooks/events";

/**
 * D-09 / OUT-11..14 — emit per-mutation outbound webhook events for TestRuns
 * lifecycle. Detection logic for state transitions and the
 * "transitioned-into-completed" sub-case lives here so the lib/prisma.ts
 * `$extends` middleware can stay generic.
 *
 * Every emit is bound to the caller's tx (Plan 02-02 webhookEvents.emit
 * requires tx) so the outbox row commits with the producing entity write.
 */

/** Minimal shape we read from a TestRuns row to assemble payloads. */
export interface TestRunRow {
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

export async function emitTestRunCreated(
  row: TestRunRow,
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
    "test_run.created",
    {
      runId: row.id,
      runName: row.name,
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

export async function emitTestRunUpdateEvents(
  oldRow: TestRunRow | null,
  newRow: TestRunRow,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  if (!oldRow) return;
  const stateChanged = oldRow.stateId !== newRow.stateId;
  if (!stateChanged) return; // D-09 lifecycle policy: no-op when state unchanged.

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
    "test_run.state_changed",
    {
      runId: newRow.id,
      runName: newRow.name,
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
    // D-15 — payload is the full TestRunSummaryData shape used by the
    // in-app summary UI. Read inside the same tx so post-write state is
    // consistent with what consumers will see.
    const summary = await getTestRunSummary(newRow.id, { client: tx });
    await webhookEvents.emit(
      "test_run.completed",
      summary as unknown as Record<string, unknown>,
      {
        projectId: opts.projectId ?? newRow.projectId,
        tx,
        actorUserId: opts.actorUserId,
      }
    );
  }
}

/** Shape a TestRunResults row read from the $extends hook. */
export interface TestRunResultRow {
  id: number;
  testRunId: number;
  testRunCaseId: number;
  statusId?: number | null;
  attempt?: number | null;
  executedById?: string | null;
  executedAt?: Date | null;
}

export async function emitTestRunResultAdded(
  row: TestRunResultRow,
  tx: Prisma.TransactionClient,
  opts: EmitOptions = {}
): Promise<void> {
  // Fetch the producing testRun + status + linked repository case (via
  // testRunCases) to enrich the payload. Status is required on
  // TestRunResults so we can always look it up.
  const [run, status, testRunCase] = await Promise.all([
    tx.testRuns.findUnique({
      where: { id: row.testRunId },
      select: { id: true, name: true, projectId: true },
    }),
    row.statusId != null
      ? tx.status.findUnique({
          where: { id: row.statusId },
          select: { id: true, name: true, isCompleted: true },
        })
      : Promise.resolve(null),
    tx.testRunCases.findUnique({
      where: { id: row.testRunCaseId },
      select: {
        repositoryCase: { select: { id: true, name: true } },
      },
    }),
  ]);
  if (!run) return; // testRun deleted between insert and emit — skip.
  await webhookEvents.emit(
    "test_run.result_added",
    {
      runId: run.id,
      runName: run.name,
      caseId: testRunCase?.repositoryCase?.id ?? null,
      caseName: testRunCase?.repositoryCase?.name ?? null,
      resultId: row.id,
      statusId: status?.id ?? null,
      statusName: status?.name ?? null,
      isCompleted: status?.isCompleted ?? false,
      executedById: row.executedById ?? null,
      executedAt: row.executedAt?.toISOString() ?? null,
      attempt: row.attempt ?? 1,
    },
    {
      projectId: opts.projectId ?? run.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}

export async function emitTestRunDuplicated(
  newRunId: number,
  sourceRunId: number,
  tx: Prisma.TransactionClient,
  opts: EmitOptions & { projectId: number }
): Promise<void> {
  const newRun = await tx.testRuns.findUnique({
    where: { id: newRunId },
    select: { id: true, name: true, projectId: true },
  });
  if (!newRun) return;
  await webhookEvents.emit(
    "test_run.duplicated",
    {
      newRunId: newRun.id,
      sourceRunId,
      runName: newRun.name,
      projectId: newRun.projectId,
    },
    {
      projectId: opts.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}
