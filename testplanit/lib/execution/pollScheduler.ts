import { JOB_POLL_ACTIVE_EXECUTIONS } from "~/lib/queueNames";
import type { DbClient } from "~/lib/zenstack";

/**
 * The status poll only has work while an execution is in flight, so its
 * scheduler exists only then: it is created when an execution is requested
 * and removed by the poll that finds nothing left to watch.
 */

export const EXECUTION_POLL_PATTERN = "* * * * *";

export const IN_FLIGHT_EXECUTION_STATUSES = [
  "PENDING",
  "DISPATCHED",
  "RUNNING",
] as const;

export interface ExecutionPollQueue {
  upsertJobScheduler: (
    id: string,
    repeat: { pattern: string },
    template: {
      name: string;
      data: { tenantId?: string };
      opts: { removeOnComplete: boolean; removeOnFail: boolean };
    }
  ) => Promise<unknown>;
  removeJobScheduler: (id: string) => Promise<unknown>;
}

export function executionPollSchedulerId(tenantId?: string): string {
  return tenantId
    ? `${JOB_POLL_ACTIVE_EXECUTIONS}-${tenantId}`
    : JOB_POLL_ACTIVE_EXECUTIONS;
}

/**
 * A finished poll is superseded by the next minute's run, so its job is
 * dropped as soon as it ends. Boolean on purpose: an age or count limit
 * would trim the queue's whole failed set, dispatch failures included.
 */
export async function ensureExecutionPollScheduler(
  queue: ExecutionPollQueue,
  tenantId?: string
): Promise<void> {
  await queue.upsertJobScheduler(
    executionPollSchedulerId(tenantId),
    { pattern: EXECUTION_POLL_PATTERN },
    {
      name: JOB_POLL_ACTIVE_EXECUTIONS,
      data: { tenantId },
      opts: { removeOnComplete: true, removeOnFail: true },
    }
  );
}

function countInFlightExecutions(db: DbClient): Promise<number> {
  return db.testRunExecution.count({
    where: { status: { in: [...IN_FLIGHT_EXECUTION_STATUSES] } },
  });
}

/**
 * Remove the poll scheduler when no execution is in flight. Returns whether
 * it was removed.
 *
 * A request can create its row and scheduler between the first count and the
 * removal, which would delete the scheduler that request relies on. Requests
 * create the row before the scheduler, so a second count after the removal
 * sees that row and puts the scheduler back.
 */
export async function retireIdleExecutionPollScheduler(
  db: DbClient,
  queue: ExecutionPollQueue,
  tenantId?: string
): Promise<boolean> {
  if ((await countInFlightExecutions(db)) > 0) return false;
  await queue.removeJobScheduler(executionPollSchedulerId(tenantId));
  if ((await countInFlightExecutions(db)) > 0) {
    await ensureExecutionPollScheduler(queue, tenantId);
    return false;
  }
  return true;
}
