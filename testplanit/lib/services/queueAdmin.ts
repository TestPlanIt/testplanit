import type { Job, Queue } from "bullmq";
import { getAllQueues } from "~/lib/queues";
import { cancelFlagsForJob, setCancelFlags } from "./jobCancel";

/**
 * Resolve an admin-page queue name (the BullMQ queue's own `name`, as the
 * list route publishes it) to its Queue across every queue in the registry,
 * so a queue added to getAllQueues() is reachable without a map update.
 */
export function getQueueByName(queueName: string): Queue | null {
  for (const queue of Object.values(getAllQueues())) {
    if (queue && queue.name === queueName) {
      return queue;
    }
  }
  return null;
}

/**
 * A job a worker is processing cannot be removed: BullMQ keeps its lock and
 * the worker keeps running it, so a "removed" active job only disappears
 * from the page. Callers answer 409 and offer Cancel when the job's
 * processor honours a cancel flag.
 */
export class ActiveJobError extends Error {
  constructor(
    message: string,
    public readonly cancellable: boolean,
    /** For a repeatable job: its schedule was removed before the lock refused the instance. */
    public readonly scheduleRemoved = false
  ) {
    super(message);
    this.name = "ActiveJobError";
  }
}

/** The job's processor checks no cancel flag, so nothing can stop it early. */
export class NotCancellableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotCancellableError";
  }
}

const REMOVE_ATTEMPTS = 3;

function isLockedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("locked");
}

/**
 * Remove a job that is not being processed. `force` retries a removal that
 * the lock refused, for a job whose worker died and whose lock is about to
 * expire; it never reports a removal that did not happen. A repeatable
 * instance (`repeat:` id) has its schedule removed first so it will not
 * recur.
 */
export async function removeJob(
  queue: Queue,
  queueName: string,
  job: Job,
  force = false
): Promise<void> {
  const jobId = String(job.id ?? "");
  const isRepeatable = jobId.startsWith("repeat:");
  const repeatKey = isRepeatable ? jobId.split(":")[1] : undefined;
  const cancellable = cancelFlagsForJob(queueName, job) !== null;

  const state = await job.getState();
  if (state === "active" && !force) {
    throw new ActiveJobError(
      `Cannot remove an active${isRepeatable ? " scheduled" : ""} job: a worker is processing it.${cancellable ? " Cancel it instead, and remove it once it has stopped." : " Wait for it to finish."}`,
      cancellable
    );
  }

  let scheduleRemoved = false;
  if (isRepeatable && repeatKey) {
    try {
      const repeatable = await queue.getRepeatableJobs();
      if (repeatable.some((entry) => entry.key === repeatKey)) {
        await queue.removeRepeatableByKey(repeatKey);
        scheduleRemoved = true;
      }
    } catch (error) {
      console.warn(
        "Failed to remove repeatable schedule:",
        error instanceof Error ? error.message : error
      );
    }
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await job.remove();
      return;
    } catch (error) {
      if (!isLockedError(error)) throw error;
      if (!force || attempt >= REMOVE_ATTEMPTS) {
        throw new ActiveJobError(
          `The job is still locked by a worker and was not removed.${scheduleRemoved ? " Its schedule was removed, so it will not recur." : ""}${cancellable ? " Cancel it and remove it once it has stopped." : ""}`,
          cancellable,
          scheduleRemoved
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

export type CancelJobOutcome =
  /** The worker was asked to stop; the job stays until it does. */
  | { cancelling: true; removed: false }
  /** The job had not started, so it was removed outright. */
  | { cancelling: false; removed: true };

/**
 * Stop a job early. A job a worker is processing gets the cancel flag its
 * processor polls (and fails with NotCancellableError when it has none); a
 * job still waiting is simply removed.
 */
export async function cancelJob(
  queue: Queue,
  queueName: string,
  job: Job
): Promise<CancelJobOutcome> {
  const state = await job.getState();
  if (state === "active") {
    const keys = cancelFlagsForJob(queueName, job);
    if (!keys) {
      throw new NotCancellableError(
        "This job cannot be cancelled while it runs; wait for it to finish."
      );
    }
    await setCancelFlags(await queue.client, keys);
    return { cancelling: true, removed: false };
  }
  if (
    ["waiting", "delayed", "prioritized", "waiting-children"].includes(state)
  ) {
    await job.remove();
    return { cancelling: false, removed: true };
  }
  throw new NotCancellableError(
    `The job is ${state}, so there is nothing to cancel.`
  );
}
