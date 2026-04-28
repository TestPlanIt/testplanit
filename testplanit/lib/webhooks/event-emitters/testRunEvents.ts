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
  /** Source of truth for "is this run done" — flipping this triggers
   *  test_run.completed regardless of whether stateId changed. */
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
      runTitle: row.name,
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

  // D-09 — two INDEPENDENT lifecycle transitions on TestRuns. Either, both,
  // or neither can fire on a given update:
  //   - state_changed: stateId changed
  //   - completed:     isCompleted flipped false → true
  // isCompleted is the canonical "this run is done" signal on TestRuns —
  // a project admin can mark a run completed without changing its state,
  // and conversely change state without marking completed (e.g. moving
  // between IN_PROGRESS workflows). The Workflows.workflowType is for
  // workflow categorization, not the source of truth for completion.
  const stateChanged = oldRow.stateId !== newRow.stateId;
  const completedTransition =
    oldRow.isCompleted !== true && newRow.isCompleted === true;
  if (!stateChanged && !completedTransition) return;

  if (stateChanged) {
    const [fromState, toState] = await Promise.all([
      oldRow.stateId != null
        ? tx.workflows.findUnique({
            where: { id: oldRow.stateId },
            select: {
              name: true,
              workflowType: true,
              color: { select: { value: true } },
            },
          })
        : Promise.resolve(null),
      newRow.stateId != null
        ? tx.workflows.findUnique({
            where: { id: newRow.stateId },
            select: {
              name: true,
              workflowType: true,
              color: { select: { value: true } },
            },
          })
        : Promise.resolve(null),
    ]);

    await webhookEvents.emit(
      "test_run.state_changed",
      {
        runId: newRow.id,
        runTitle: newRow.name,
        projectId: newRow.projectId,
        from: {
          stateId: oldRow.stateId,
          stateName: fromState?.name ?? null,
          stateColor: fromState?.color?.value ?? null,
          isCompleted: oldRow.isCompleted === true,
        },
        to: {
          stateId: newRow.stateId,
          stateName: toState?.name ?? null,
          stateColor: toState?.color?.value ?? null,
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
    // D-15 — payload is the full TestRunSummaryData shape used by the
    // in-app summary UI, enriched with run identity + deep-link so Slack
    // (and any other consumer) can render a self-contained message
    // without an API round-trip.
    const summary = await getTestRunSummary(newRow.id, { client: tx });
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    // Locale-less path; next-intl resolves the recipient's preferred locale at request time.
    const runUrl = `${baseUrl}/projects/runs/${newRow.projectId}/${newRow.id}`;
    await webhookEvents.emit(
      "test_run.completed",
      {
        ...(summary as unknown as Record<string, unknown>),
        runId: newRow.id,
        runTitle: newRow.name,
        runUrl,
      },
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
          select: {
            id: true,
            name: true,
            isCompleted: true,
            isSuccess: true,
            isFailure: true,
            color: { select: { value: true } },
          },
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
      runTitle: run.name,
      projectId: run.projectId,
      caseId: testRunCase?.repositoryCase?.id ?? null,
      caseName: testRunCase?.repositoryCase?.name ?? null,
      resultId: row.id,
      statusId: status?.id ?? null,
      statusName: status?.name ?? null,
      statusColor: status?.color?.value ?? null,
      isCompleted: status?.isCompleted ?? false,
      isSuccess: status?.isSuccess ?? false,
      isFailure: status?.isFailure ?? false,
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
      runTitle: newRun.name,
      projectId: newRun.projectId,
    },
    {
      projectId: opts.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}
