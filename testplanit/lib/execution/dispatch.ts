import { SYSTEM_ACTOR_ID } from "~/lib/auditContextConstants";
import { captureAuditEvent } from "~/lib/services/auditLog";
import type { DbClient, TxClient } from "~/lib/zenstack";
import {
  createCiDispatchAdapter,
  DispatchError,
  GitHubDispatchAdapter,
} from "./adapters";
import { buildDispatchInputs, normalizeInputs } from "./inputs";
import {
  buildPlanUrl,
  emitExecutionEvent,
  EXECUTION_COMPLETED_EVENT,
  getExecutionAppUrl,
  isPollDue,
  isTimedOut,
  publishExecutionChanged,
  resolveTargetCredentials,
  sanitizeExecutionError,
  statusFromExternal,
} from "./service";
import type { DispatchRequest, TestRunExecutionStatusKind } from "./types";

/**
 * Worker-side logic: start the CI job for a PENDING execution, and advance
 * DISPATCHED/RUNNING executions by polling their provider. Kept out of the
 * BullMQ worker file so it can be unit-tested with a fake client.
 */

type ExecutionWithTarget = {
  id: number;
  testRunId: number;
  projectId: number;
  status: string;
  ref: string | null;
  inputs: unknown;
  externalRunId: string | null;
  externalUrl: string | null;
  pollCount: number;
  dispatchedAt: Date | null;
  lastPolledAt: Date | null;
  createdAt: Date;
  target: {
    id: number;
    provider: string;
    workflowRef: string | null;
    defaultRef: string | null;
    url: string | null;
    staticInputs: unknown;
    credentials: unknown;
    timeoutMinutes: number;
    isEnabled: boolean;
    isDeleted: boolean;
    codeRepository: {
      provider: string;
      credentials: unknown;
      settings: unknown;
    } | null;
  };
};

const withTarget = {
  target: { include: { codeRepository: true } },
} as const;

export type DispatchOutcome =
  | { outcome: "dispatched"; executionId: number }
  | { outcome: "dispatch_failed"; executionId: number; error: string }
  | { outcome: "skipped"; executionId: number; reason: string };

export async function dispatchExecution(
  db: DbClient,
  executionId: number,
  opts: { tenantId?: string; now?: () => Date } = {}
): Promise<DispatchOutcome> {
  const now = opts.now ?? (() => new Date());
  const execution = (await db.testRunExecution.findUnique({
    where: { id: executionId },
    include: withTarget,
  })) as unknown as ExecutionWithTarget | null;

  if (!execution)
    return { outcome: "skipped", executionId, reason: "not found" };
  if (execution.status !== "PENDING") {
    return {
      outcome: "skipped",
      executionId,
      reason: `status ${execution.status}`,
    };
  }

  try {
    const target = execution.target;
    if (!target.isEnabled || target.isDeleted) {
      throw new DispatchError("The execution target is disabled", "BLOCKED");
    }
    const credentials = await resolveTargetCredentials(
      target,
      target.codeRepository
    );
    const settings = (target.codeRepository?.settings ?? null) as Record<
      string,
      string
    > | null;
    const adapter = createCiDispatchAdapter(target, credentials, settings);

    const appUrl = getExecutionAppUrl();
    const req: DispatchRequest = {
      runId: execution.testRunId,
      executionId: execution.id,
      projectId: execution.projectId,
      ref: execution.ref ?? target.defaultRef ?? null,
      planUrl: buildPlanUrl(appUrl, execution.testRunId, execution.id),
      appUrl,
      inputs: {},
    };
    req.inputs = buildDispatchInputs(
      req,
      normalizeInputs(target.staticInputs),
      normalizeInputs(execution.inputs)
    );

    const result = await adapter.dispatch(req);
    const dispatchedAt = now();
    await db.testRunExecution.update({
      where: { id: execution.id },
      data: {
        status: "DISPATCHED",
        dispatchedAt,
        lastPolledAt: dispatchedAt,
        ref: result.ref ?? req.ref,
        inputs: req.inputs,
        externalRunId: result.externalRunId ?? null,
        externalUrl: result.externalUrl ?? null,
        error: null,
      },
    });
    await audit("EXECUTION_DISPATCHED", execution, opts.tenantId, {
      outcome: "dispatched",
      provider: target.provider,
      externalRunId: result.externalRunId ?? null,
      externalUrl: result.externalUrl ?? null,
    });
    publishExecutionChanged(execution);
    return { outcome: "dispatched", executionId: execution.id };
  } catch (err) {
    const message = sanitizeExecutionError(err);
    await finalizeExecution(db, execution.id, "DISPATCH_FAILED", {
      error: message,
      tenantId: opts.tenantId,
      now,
    });
    return {
      outcome: "dispatch_failed",
      executionId: execution.id,
      error: message,
    };
  }
}

/**
 * How far before the dispatch to look when adopting a run id. GitHub records
 * run creation at second precision, so a run started in the same second as
 * the dispatch can sort before `dispatchedAt`; the "exactly one run" rule in
 * the adapter keeps the wider window safe.
 */
const ADOPTION_LOOKBACK_MS = 2 * 60 * 1000;
/** A dispatched run appears within seconds; anything later is someone else's. */
const ADOPTION_LOOKAHEAD_MS = 5 * 60 * 1000;

/** A request whose dispatch job has not run after this long is given up on. */
export const STALE_PENDING_MS = 10 * 60 * 1000;

/**
 * A PENDING row means the request was recorded but the dispatch job has not
 * touched it. If the job never runs (queue down, job dropped), the row would
 * block the run forever because only one execution per run may be active.
 * Fail it so a person can retry.
 */
async function failStalePendingExecutions(
  db: DbClient,
  now: () => Date,
  tenantId?: string
): Promise<number> {
  const cutoff = new Date(now().getTime() - STALE_PENDING_MS);
  const rows = (await db.testRunExecution.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff } },
    select: { id: true, status: true, createdAt: true },
    orderBy: { id: "asc" },
    take: 100,
  })) as Array<{ id: number; status: string; createdAt: Date }>;
  let stalled = 0;
  for (const row of rows) {
    if (row.status !== "PENDING" || row.createdAt >= cutoff) continue;
    await finalizeExecution(db, row.id, "DISPATCH_FAILED", {
      error: `The dispatch job did not run within ${STALE_PENDING_MS / 60_000} minutes of the request. Check the execution-dispatch worker and retry.`,
      tenantId,
      now,
    });
    stalled += 1;
  }
  return stalled;
}

/**
 * Advance every in-flight execution for this database. Called by the
 * scheduler job once a minute per tenant; per-row backoff keeps provider
 * calls sparse. Timeouts apply to every provider, polling only to those that
 * can be asked.
 */
export async function pollActiveExecutions(
  db: DbClient,
  opts: { tenantId?: string; now?: () => Date } = {}
): Promise<{
  polled: number;
  finished: number;
  timedOut: number;
  stalled: number;
}> {
  const now = opts.now ?? (() => new Date());
  const stalled = await failStalePendingExecutions(db, now, opts.tenantId);
  const rows = (await db.testRunExecution.findMany({
    where: { status: { in: ["DISPATCHED", "RUNNING"] } },
    include: withTarget,
    orderBy: { id: "asc" },
    take: 500,
  })) as unknown as ExecutionWithTarget[];

  let polled = 0;
  let finished = 0;
  let timedOut = 0;

  for (const execution of rows) {
    if (execution.status !== "DISPATCHED" && execution.status !== "RUNNING") {
      continue;
    }
    const current = now();
    if (isTimedOut(execution, execution.target.timeoutMinutes, current)) {
      await finalizeExecution(db, execution.id, "TIMED_OUT", {
        error: `No completion within ${execution.target.timeoutMinutes} minutes`,
        tenantId: opts.tenantId,
        now,
      });
      timedOut += 1;
      continue;
    }
    if (!isPollDue(execution, current)) continue;

    let adapter;
    try {
      const credentials = await resolveTargetCredentials(
        execution.target,
        execution.target.codeRepository
      );
      adapter = createCiDispatchAdapter(
        execution.target,
        credentials,
        (execution.target.codeRepository?.settings ?? null) as Record<
          string,
          string
        > | null
      );
    } catch (err) {
      await touchPoll(db, execution, current, {
        externalStatus: `credential error: ${sanitizeExecutionError(err, 200)}`,
      });
      continue;
    }

    if (!adapter.supportsStatusPolling) {
      // Nothing to ask; only the timeout above and the results/complete
      // hooks move these. Still stamp the poll so the row is not re-read
      // every minute.
      await touchPoll(db, execution, current, {});
      continue;
    }

    // GHES (and any 204-only dispatch) left us without a run id — try to adopt
    // the one workflow_dispatch run created after we dispatched.
    if (!execution.externalRunId && adapter instanceof GitHubDispatchAdapter) {
      const anchor = execution.dispatchedAt ?? execution.createdAt;
      const adopted = await adapter.findRunCreatedAfter(
        execution.ref,
        new Date(anchor.getTime() - ADOPTION_LOOKBACK_MS),
        new Date(anchor.getTime() + ADOPTION_LOOKAHEAD_MS)
      );
      if (adopted) {
        execution.externalRunId = adopted.externalRunId;
        await db.testRunExecution.update({
          where: { id: execution.id },
          data: {
            externalRunId: adopted.externalRunId,
            ...(adopted.externalUrl
              ? { externalUrl: adopted.externalUrl }
              : {}),
          },
        });
      } else {
        await touchPoll(db, execution, current, {});
        continue;
      }
    }
    if (!execution.externalRunId) {
      await touchPoll(db, execution, current, {});
      continue;
    }

    polled += 1;
    try {
      const external = await adapter.getStatus(execution.externalRunId);
      const next = statusFromExternal(
        execution.status as TestRunExecutionStatusKind,
        external
      );
      const patch: Record<string, unknown> = {
        externalStatus: external.raw ?? null,
        ...(external.url ? { externalUrl: external.url } : {}),
      };
      if (next && next !== execution.status) {
        if (isTerminal(next)) {
          await finalizeExecution(db, execution.id, next, {
            tenantId: opts.tenantId,
            now,
            extra: patch,
          });
          finished += 1;
          continue;
        }
        patch.status = next;
      }
      await touchPoll(db, execution, current, patch);
      if (patch.status) publishExecutionChanged(execution);
    } catch (err) {
      // Transient: keep the status, note the problem, back off.
      await touchPoll(db, execution, current, {
        externalStatus: `poll error: ${sanitizeExecutionError(err, 200)}`,
      });
    }
  }
  return { polled, finished, timedOut, stalled };
}

type TerminalStatus = Extract<
  TestRunExecutionStatusKind,
  "SUCCEEDED" | "FAILED" | "DISPATCH_FAILED" | "TIMED_OUT" | "CANCELLED"
>;

function isTerminal(
  status: TestRunExecutionStatusKind
): status is TerminalStatus {
  return (
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "DISPATCH_FAILED" ||
    status === "TIMED_OUT" ||
    status === "CANCELLED"
  );
}

async function touchPoll(
  db: DbClient,
  execution: ExecutionWithTarget,
  now: Date,
  patch: Record<string, unknown>
): Promise<void> {
  await db.testRunExecution.update({
    where: { id: execution.id },
    data: { ...patch, lastPolledAt: now, pollCount: { increment: 1 } },
  });
}

/**
 * Move an execution to a terminal state inside one transaction with the
 * outbound event, then audit and wake the run page.
 */
export async function finalizeExecution(
  db: DbClient,
  executionId: number,
  status: TerminalStatus,
  opts: {
    error?: string | null;
    extra?: Record<string, unknown>;
    tenantId?: string;
    actorUserId?: string;
    now?: () => Date;
  } = {}
): Promise<void> {
  const now = opts.now ?? (() => new Date());
  const updated = await db.$transaction(async (tx: TxClient) => {
    const row = await tx.testRunExecution.update({
      where: { id: executionId },
      data: {
        ...(opts.extra ?? {}),
        status,
        completedAt: now(),
        ...(opts.error !== undefined ? { error: opts.error } : {}),
      },
    });
    await emitExecutionEvent(
      tx,
      EXECUTION_COMPLETED_EVENT,
      row,
      opts.actorUserId
    );
    return row;
  });
  await audit(
    "EXECUTION_COMPLETED",
    updated,
    opts.tenantId,
    {
      outcome: status,
      error: updated.error ?? null,
      externalRunId: updated.externalRunId ?? null,
    },
    opts.actorUserId
  );
  publishExecutionChanged(updated);
  if (
    updated.adHoc &&
    updated.resultsReceivedAt &&
    (status === "SUCCEEDED" || status === "FAILED")
  ) {
    await completeAdHocRun(db, updated.testRunId, now);
  }
}

/**
 * A "Run automated test" run exists only to carry one execution, so it
 * completes itself once the job has finished and its results are in. Goes
 * through the ordinary run update so the completion side effects (summary,
 * webhooks, notifications) fire exactly as for a person completing it.
 * Dispatch failures, timeouts and cancellations leave the run open for Retry.
 */
async function completeAdHocRun(
  db: DbClient,
  runId: number,
  now: () => Date
): Promise<boolean> {
  try {
    const run = await db.testRuns.findUnique({
      where: { id: runId },
      select: { isCompleted: true, isDeleted: true },
    });
    if (!run || run.isCompleted || run.isDeleted) return false;
    await db.testRuns.update({
      where: { id: runId },
      data: { isCompleted: true, completedAt: now() },
    });
    return true;
  } catch (err) {
    console.warn(
      "[execution] could not complete ad-hoc run (non-blocking):",
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

async function audit(
  action: "EXECUTION_DISPATCHED" | "EXECUTION_COMPLETED",
  execution: {
    id: number;
    testRunId: number;
    projectId: number;
    targetId?: number;
  },
  tenantId: string | undefined,
  metadata: Record<string, unknown>,
  actorUserId?: string
): Promise<void> {
  try {
    await captureAuditEvent({
      action,
      entityType: "TestRunExecution",
      entityId: String(execution.id),
      projectId: execution.projectId,
      userId: actorUserId ?? SYSTEM_ACTOR_ID,
      metadata: { testRunId: execution.testRunId, ...metadata },
      ...(tenantId ? { tenantId } : {}),
    });
  } catch (err) {
    console.warn(
      "[execution] audit capture failed (non-blocking):",
      err instanceof Error ? err.message : String(err)
    );
  }
}
