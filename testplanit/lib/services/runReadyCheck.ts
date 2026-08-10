/**
 * "Every case has been executed" detection for test runs.
 *
 * When the last outstanding piece of work in a run gets a final result, the
 * people who can close the run are told it is ready. The run is NOT completed
 * automatically — completing is irreversible in-app (see the structural
 * completion lock on TestRunCases in schema.zmodel), so the decision stays
 * with a person.
 *
 * Two rules make the predicate correct rather than merely plausible:
 *
 *  1. "Executed" means the status carries `isCompleted`, not merely that a
 *     status exists. Untested is a status a tester can pick explicitly, and
 *     Retest / Blocked are statuses that mean the work is not finished. All
 *     three must hold the run open.
 *  2. Iterations are checked separately from cases. `computeWorstOfStatus`
 *     ignores iterations with no status, so a parameterized case with one of
 *     ten iterations passed rolls up to Passed — a case-level-only predicate
 *     would call that run finished after the first iteration.
 *
 * Automated runs are out of scope: their summaries come from JUnitTestResult
 * rather than TestRunCases, so these counts don't describe them.
 */

import { getNotificationQueue } from "~/lib/queues";

export const JOB_CHECK_RUN_READY = "check-run-ready";

/**
 * Evaluation is deferred by this much so the worker reads committed state —
 * the plugin hook that enqueues it runs inside the writer's transaction.
 * Doubles as a debounce: a bulk submission touching hundreds of cases
 * collapses onto one job id and evaluates once.
 */
const READY_CHECK_DELAY_MS = 5000;

export interface RunReadyCheckJobData {
  runId: number;
  tenantId?: string;
}

export function runReadyCheckJobId(
  runId: number,
  tenantId: string | undefined
): string {
  return `runready:${tenantId ?? "default"}:${runId}`;
}

/**
 * Queues a readiness evaluation. Never throws into the caller: this is
 * bookkeeping hung off a user's result submission, and a Valkey hiccup must
 * not fail their write.
 */
export async function enqueueRunReadyCheck(
  runId: number,
  tenantId?: string
): Promise<void> {
  const queue = getNotificationQueue();
  if (!queue) return;

  try {
    await queue.add(
      JOB_CHECK_RUN_READY,
      { runId, tenantId } satisfies RunReadyCheckJobData,
      {
        jobId: runReadyCheckJobId(runId, tenantId),
        delay: READY_CHECK_DELAY_MS,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  } catch (error) {
    console.error(
      `[runReadyToComplete] failed to queue readiness check for run ${runId}:`,
      error
    );
  }
}

interface ReadinessDb {
  $queryRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<any[]>;
  testRuns: {
    findUnique: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
}

export interface RunReadiness {
  liveCases: number;
  openCases: number;
  openIterations: number;
  isReady: boolean;
}

/** The two counts the predicate is built from. */
export async function evaluateRunReadiness(
  db: ReadinessDb,
  runId: number
): Promise<RunReadiness> {
  const caseRows = await db.$queryRaw`
    SELECT
      COUNT(*)::int AS "liveCases",
      COUNT(*) FILTER (
        WHERE s.id IS NULL OR s."isCompleted" = false
      )::int AS "openCases"
    FROM "TestRunCases" trc
    LEFT JOIN "Status" s ON s.id = trc."statusId"
    WHERE trc."testRunId" = ${runId}
      AND trc."isDeleted" = false
  `;

  const liveCases = Number(caseRows?.[0]?.liveCases ?? 0);
  const openCases = Number(caseRows?.[0]?.openCases ?? 0);

  // Only worth asking when nothing is open at the case level.
  let openIterations = 0;
  if (liveCases > 0 && openCases === 0) {
    const iterationRows = await db.$queryRaw`
      SELECT COUNT(*)::int AS "openIterations"
      FROM "TestRunCaseIteration" i
      JOIN "TestRunCases" trc ON trc.id = i."testRunCaseId"
      LEFT JOIN "Status" s ON s.id = i."statusId"
      WHERE trc."testRunId" = ${runId}
        AND trc."isDeleted" = false
        AND i."isDeleted" = false
        AND (s.id IS NULL OR s."isCompleted" = false)
    `;
    openIterations = Number(iterationRows?.[0]?.openIterations ?? 0);
  }

  return {
    liveCases,
    openCases,
    openIterations,
    // A run with no live cases trivially satisfies "nothing outstanding" and
    // is obviously not ready for anything.
    isReady: liveCases > 0 && openCases === 0 && openIterations === 0,
  };
}

export interface RunReadyOutcome {
  /** Set when this call claimed the transition and a notification is owed. */
  notify: {
    runId: number;
    runName: string;
    projectId: number;
    projectName: string;
    caseCount: number;
  } | null;
  /** Why nothing was claimed, for logs and tests. */
  reason:
    | "notified"
    | "not-found"
    | "not-regular"
    | "already-completed"
    | "not-ready"
    | "already-notified";
}

/**
 * Evaluates one run and claims the "became ready" transition if it is the
 * first to see it.
 *
 * The claim is a compare-and-set on `readyToCompleteNotifiedAt`: exactly one
 * concurrent caller gets `count === 1`, the rest get 0 and stay quiet. Stamped
 * before the notification is sent, so a crash between the two loses one
 * notification rather than sending a burst of duplicates.
 *
 * When the run is no longer ready the marker is cleared, which re-arms the
 * notification for the next time it fills up. That is what makes deleting a
 * result and re-recording it produce a second notification rather than
 * silence.
 *
 * Pass the RAW client: writing the marker through a plugin-carrying client
 * would re-run the run's Elasticsearch sync and webhook emitters on what is
 * pure bookkeeping.
 */
export async function claimRunReadyTransition(
  db: ReadinessDb,
  runId: number
): Promise<RunReadyOutcome> {
  const run = await db.testRuns.findUnique({
    where: { id: runId },
    select: {
      id: true,
      name: true,
      projectId: true,
      testRunType: true,
      isCompleted: true,
      isDeleted: true,
      readyToCompleteNotifiedAt: true,
      project: { select: { name: true } },
    },
  });

  if (!run || run.isDeleted) return { notify: null, reason: "not-found" };

  // Manual runs only. An allowlist, not "not automated": the seven imported
  // types (JUNIT/TESTNG/XUNIT/NUNIT/MSTEST/MOCHA/CUCUMBER — see
  // AUTOMATED_TEST_RUN_TYPES) reach completion through the import pipeline and
  // the abandoned-run sweeper, and summarise from JUnitTestResult rather than
  // TestRunCases, so these counts do not even describe them. Anything new that
  // is neither stays silent until someone decides it should not.
  if (run.testRunType !== "REGULAR") {
    return { notify: null, reason: "not-regular" };
  }

  const readiness = await evaluateRunReadiness(db, runId);

  if (!readiness.isReady) {
    if (run.readyToCompleteNotifiedAt != null) {
      await db.testRuns.updateMany({
        where: { id: runId, readyToCompleteNotifiedAt: { not: null } },
        data: { readyToCompleteNotifiedAt: null },
      });
    }
    return { notify: null, reason: "not-ready" };
  }

  // A completed run needs no nudge, but it should still hold the marker so
  // it doesn't fire the moment someone clears isCompleted in the database.
  if (run.isCompleted) return { notify: null, reason: "already-completed" };

  const { count } = await db.testRuns.updateMany({
    where: {
      id: runId,
      readyToCompleteNotifiedAt: null,
      isCompleted: false,
      isDeleted: false,
    },
    data: { readyToCompleteNotifiedAt: new Date() },
  });

  if (count === 0) return { notify: null, reason: "already-notified" };

  return {
    reason: "notified",
    notify: {
      runId: run.id,
      runName: run.name,
      projectId: run.projectId,
      projectName: run.project?.name ?? "",
      caseCount: readiness.liveCases,
    },
  };
}
