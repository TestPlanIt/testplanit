import {
  IMPACT_ANALYSIS_QUEUE_NAME,
  JOB_SCAN_REPO_ISSUES,
  REPO_CACHE_QUEUE_NAME,
} from "~/lib/queueNames";
import { impactCancelKey, issueScanCancelKey } from "./impact/jobKeys";

/** How long a cancel request stays set if nothing consumes it. */
export const JOB_CANCEL_TTL_SECONDS = 3600;

/**
 * The subset of a Redis client the cancel flags need. Both the raw ioredis
 * connection the workers hold and the client BullMQ hands out from
 * `queue.client` fit: the expiry is passed positionally (`"EX", seconds`),
 * which ioredis expects and BullMQ's client passes through.
 */
export interface CancelFlagStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...expiry: any[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

/**
 * The flag a worker polls to stop one job early. Keyed by queue and job id
 * so an admin can cancel any job whose processor checks it.
 */
export function jobCancelKey(queueName: string, jobId: string): string {
  return `job:cancel:${queueName}:${jobId}`;
}

/**
 * Every flag that stops the given job, or null when its processor checks
 * none and the job cannot be cancelled cooperatively. Ticket scans keep
 * their per-connection flag (the settings page's Cancel sets only that
 * one) beside the per-job flag every repo-cache job polls; analyses have
 * their own per-job flag.
 */
export function cancelFlagsForJob(
  queueName: string,
  job: { id?: string | null; name: string; data?: unknown }
): string[] | null {
  const jobId = String(job.id ?? "");
  if (!jobId) return null;
  switch (queueName) {
    case REPO_CACHE_QUEUE_NAME: {
      const keys = [jobCancelKey(queueName, jobId)];
      const configId = Number((job.data as { configId?: unknown })?.configId);
      if (job.name === JOB_SCAN_REPO_ISSUES && Number.isFinite(configId)) {
        keys.push(issueScanCancelKey(configId));
      }
      return keys;
    }
    case IMPACT_ANALYSIS_QUEUE_NAME:
      return [impactCancelKey(jobId)];
    default:
      return null;
  }
}

export async function setCancelFlags(
  store: CancelFlagStore,
  keys: string[]
): Promise<void> {
  for (const key of keys) {
    await store.set(key, "1", "EX", JOB_CANCEL_TTL_SECONDS);
  }
}

export async function isJobCancelRequested(
  store: CancelFlagStore | null | undefined,
  queueName: string,
  jobId: string
): Promise<boolean> {
  if (!store) return false;
  try {
    return Boolean(await store.get(jobCancelKey(queueName, jobId)));
  } catch {
    return false;
  }
}

export async function clearJobCancel(
  store: CancelFlagStore | null | undefined,
  queueName: string,
  jobId: string
): Promise<void> {
  if (!store) return;
  await store.del(jobCancelKey(queueName, jobId)).catch(() => {});
}
