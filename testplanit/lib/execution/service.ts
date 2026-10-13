import { getAppBaseUrl } from "~/lib/auth-security";
import { resolveStoredCredentials } from "~/lib/integrations/credentials";
import { publishTestRunWakeUp } from "~/lib/live/publish";
import { webhookEvents } from "~/lib/webhooks/events";
import type { TxClient } from "~/lib/zenstack";
import {
  ACTIVE_EXECUTION_STATUSES,
  type ExternalStatus,
  type TestRunExecutionStatusKind,
} from "./types";

/**
 * Execution lifecycle helpers shared by the execute routes, the dispatch
 * worker, the scheduler poll, the import route and the run-completion hook.
 * Every function takes the client it should write through (baseDb or a tx).
 */

export const EXECUTION_REQUESTED_EVENT = "test_run.execution_requested";
export const EXECUTION_COMPLETED_EVENT = "test_run.execution_completed";
export const EXECUTION_WAKEUP_EVENT = "test_run.execution_changed" as const;

export const MAX_EXECUTION_ERROR_LENGTH = 1024;

type ExecutionRow = {
  id: number;
  testRunId: number;
  projectId: number;
  targetId: number;
  provider: string;
  status: string;
  requestedById: string;
  ref: string | null;
  externalRunId: string | null;
  externalUrl: string | null;
  externalStatus: string | null;
  error: string | null;
  selectionCount: number;
  dispatchedAt: Date | null;
  completedAt: Date | null;
};

type ExecutionDb = {
  testRunExecution: {
    findFirst: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
  $queryRaw: (...args: any[]) => Promise<any>;
};

export function getExecutionAppUrl(request?: Request): string {
  return getAppBaseUrl(request).replace(/\/$/, "");
}

export function buildPlanUrl(
  appUrl: string,
  runId: number,
  executionId?: number | null
): string {
  const base = `${appUrl}/api/test-runs/${runId}/automation-plan`;
  return executionId ? `${base}?executionId=${executionId}` : base;
}

/**
 * Token-shaped substrings a provider might echo back in an error body:
 * GitHub PATs, GitLab access/trigger tokens, bearer/token headers, and any
 * long opaque hex or base64 blob.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  /\b(glpat-[A-Za-z0-9_-]{10,}|glptt-[A-Za-z0-9_-]{10,}|glrt-[A-Za-z0-9_-]{10,})/g,
  /\b(bearer|token|private-token)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
];

export function scrubSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const head = match.split(/\s+/)[0];
      return /^(bearer|token|private-token)$/i.test(head)
        ? `${head} [redacted]`
        : "[redacted]";
    });
  }
  return out;
}

/** Truncate and scrub anything token-shaped before it is stored or shown. */
export function sanitizeExecutionError(
  err: unknown,
  max: number = MAX_EXECUTION_ERROR_LENGTH
): string {
  const raw =
    err instanceof Error ? err.message : String(err ?? "Unknown error");
  const scrubbed = scrubSecrets(raw.trim()) || "Unknown error";
  return scrubbed.length > max ? `${scrubbed.slice(0, max - 1)}…` : scrubbed;
}

/**
 * Credentials for a target: its own override when set, otherwise the backing
 * repository's. The generic provider only ever has its own.
 */
export async function resolveTargetCredentials(
  target: { provider: string; credentials: unknown },
  repository: { provider: string; credentials: unknown } | null
): Promise<Record<string, string>> {
  const own = target.credentials
    ? await resolveStoredCredentials(target.credentials, target.provider)
    : {};
  if (target.provider === "GENERIC_WEBHOOK") return own;
  const fromRepo = repository
    ? await resolveStoredCredentials(
        repository.credentials,
        repository.provider
      )
    : {};
  return { ...fromRepo, ...own };
}

export async function findActiveExecution(
  db: ExecutionDb,
  runId: number
): Promise<ExecutionRow | null> {
  return db.testRunExecution.findFirst({
    where: { testRunId: runId, status: { in: ACTIVE_EXECUTION_STATUSES } },
    orderBy: { id: "desc" },
  });
}

/**
 * Results reached the run (import route). Stamps the active execution and,
 * for providers that cannot be polled, moves DISPATCHED → RUNNING so the chip
 * shows that the job is alive. Never throws — results must land regardless.
 */
export async function markExecutionResultsReceived(
  db: ExecutionDb,
  runId: number
): Promise<void> {
  try {
    // Raw on purpose: TestRunExecution denies every ORM write, and this runs
    // inside the reporter's policy-scoped transaction (side-effect plugin) as
    // well as on baseDb from the import route. The first stamp wins.
    const rows = (await db.$queryRaw`
      UPDATE "TestRunExecution"
      SET "resultsReceivedAt" = COALESCE("resultsReceivedAt", NOW()),
          "status" = CASE
            WHEN "status" = 'DISPATCHED' THEN 'RUNNING'::"TestRunExecutionStatus"
            ELSE "status"
          END,
          "updatedAt" = NOW()
      WHERE "testRunId" = ${runId}
        AND "status" IN ('PENDING', 'DISPATCHED', 'RUNNING')
      RETURNING "id", "projectId"`) as Array<{ id: number; projectId: number }>;
    for (const row of rows) {
      publishExecutionChanged({
        id: row.id,
        testRunId: runId,
        projectId: row.projectId,
      });
    }
  } catch (err) {
    console.warn(
      "[execution] markExecutionResultsReceived failed (non-blocking):",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * The run was completed (by a person, the CLI, a reporter that owns the run,
 * or the abandoned-run sweeper). Any execution still in flight is done.
 */
export async function completeExecutionsForRun(
  tx: TxClient | ExecutionDb,
  runId: number,
  conclusion: "SUCCEEDED" | "FAILED" | "CANCELLED" = "SUCCEEDED"
): Promise<number> {
  const db = tx as unknown as ExecutionDb;
  // Raw on purpose: this runs inside whoever completed the run — often a
  // person's policy-scoped transaction — and TestRunExecution denies every
  // ORM write outside server code.
  const rows = (await db.$queryRaw`
    UPDATE "TestRunExecution"
    SET "status" = ${conclusion}::"TestRunExecutionStatus",
        "completedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE "testRunId" = ${runId}
      AND "status" IN ('PENDING', 'DISPATCHED', 'RUNNING')
    RETURNING "id", "projectId"`) as Array<{ id: number; projectId: number }>;
  for (const row of rows) {
    publishExecutionChanged({
      id: row.id,
      testRunId: runId,
      projectId: row.projectId,
    });
  }
  return rows.length;
}

/** Map a provider's state onto ours. `null` = no change. */
export function statusFromExternal(
  current: TestRunExecutionStatusKind,
  external: ExternalStatus
): TestRunExecutionStatusKind | null {
  switch (external.state) {
    case "queued":
      return current === "PENDING" ? "DISPATCHED" : null;
    case "in_progress":
      return current === "RUNNING" ? null : "RUNNING";
    case "completed":
      switch (external.conclusion) {
        case "success":
        case "skipped":
          return "SUCCEEDED";
        case "cancelled":
          return "CANCELLED";
        case "timed_out":
          return "TIMED_OUT";
        default:
          return "FAILED";
      }
    default:
      return null;
  }
}

export function isTerminalStatus(status: string): boolean {
  return !ACTIVE_EXECUTION_STATUSES.includes(
    status as TestRunExecutionStatusKind
  );
}

/** Poll backoff: 30s, 60s, 120s… capped at 5 minutes. */
export function nextPollDelayMs(pollCount: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, pollCount), 5 * 60_000);
}

export function isPollDue(
  execution: {
    lastPolledAt: Date | null;
    dispatchedAt: Date | null;
    pollCount: number;
  },
  now: Date = new Date()
): boolean {
  const last = execution.lastPolledAt ?? execution.dispatchedAt;
  if (!last) return true;
  return now.getTime() - last.getTime() >= nextPollDelayMs(execution.pollCount);
}

export function isTimedOut(
  execution: { dispatchedAt: Date | null; createdAt?: Date },
  timeoutMinutes: number,
  now: Date = new Date()
): boolean {
  const start = execution.dispatchedAt ?? execution.createdAt;
  if (!start) return false;
  return now.getTime() - start.getTime() >= timeoutMinutes * 60_000;
}

export function publishExecutionChanged(execution: {
  id: number;
  testRunId: number;
  projectId: number;
}): void {
  try {
    publishTestRunWakeUp({
      event: EXECUTION_WAKEUP_EVENT,
      runId: execution.testRunId,
      projectId: execution.projectId,
      targetId: execution.id,
    });
  } catch {
    // wake-ups are advisory
  }
}

export function executionWebhookPayload(execution: ExecutionRow) {
  return {
    id: execution.id,
    testRunId: execution.testRunId,
    projectId: execution.projectId,
    targetId: execution.targetId,
    provider: execution.provider,
    status: execution.status,
    requestedById: execution.requestedById,
    ref: execution.ref,
    externalRunId: execution.externalRunId,
    externalUrl: execution.externalUrl,
    error: execution.error,
    selectionCount: execution.selectionCount,
    dispatchedAt: execution.dispatchedAt?.toISOString() ?? null,
    completedAt: execution.completedAt?.toISOString() ?? null,
  };
}

export async function emitExecutionEvent(
  tx: TxClient,
  eventName:
    typeof EXECUTION_REQUESTED_EVENT | typeof EXECUTION_COMPLETED_EVENT,
  execution: ExecutionRow,
  actorUserId?: string
): Promise<void> {
  try {
    await webhookEvents.emit(eventName, executionWebhookPayload(execution), {
      tx,
      projectId: execution.projectId,
      ...(actorUserId ? { actorUserId } : {}),
    } as never);
  } catch (err) {
    console.warn(
      `[execution] failed to emit ${eventName} (non-blocking):`,
      err instanceof Error ? err.message : String(err)
    );
  }
}
