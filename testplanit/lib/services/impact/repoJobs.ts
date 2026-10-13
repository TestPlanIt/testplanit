import type { Job, JobsOptions, Queue } from "bullmq";
import {
  JOB_CHECK_STALE_PINS,
  JOB_REFRESH_SINGLE_REPO_CACHE,
  JOB_SCAN_REPO_ISSUES,
} from "~/lib/queueNames";

/** The per-connection jobs the repo-cache worker runs on request. */
export type RepoJobKind = "scan-issues" | "stale-pins" | "refresh-cache";

export const REPO_JOB_NAMES: Record<RepoJobKind, string> = {
  "scan-issues": JOB_SCAN_REPO_ISSUES,
  "stale-pins": JOB_CHECK_STALE_PINS,
  "refresh-cache": JOB_REFRESH_SINGLE_REPO_CACHE,
};

/**
 * The BullMQ job id for one connection's job of a kind. One id per
 * (kind, tenant, config) means the queue itself answers "is this running?"
 * and a second request while one is queued joins it. BullMQ refuses custom
 * ids that contain ":".
 */
export function repoJobId(
  kind: RepoJobKind,
  configId: number,
  tenantId?: string | null
): string {
  const tenant = tenantId ? tenantId.replace(/[^A-Za-z0-9_-]/g, "_") : null;
  return tenant ? `${kind}-${tenant}-${configId}` : `${kind}-${configId}`;
}

/** States in which a job is still going to run, or is running. */
const LIVE_STATES: ReadonlySet<string> = new Set([
  "active",
  "waiting",
  "delayed",
  "prioritized",
  "waiting-children",
]);

export function isLiveJobState(state: string): boolean {
  return LIVE_STATES.has(state);
}

export interface FoundRepoJob {
  job: Job;
  state: string;
}

/** The job of a kind for one connection, whatever state it is in. */
export async function findRepoJob(
  queue: Pick<Queue, "getJob">,
  kind: RepoJobKind,
  configId: number,
  tenantId?: string | null
): Promise<FoundRepoJob | null> {
  const job = await queue.getJob(repoJobId(kind, configId, tenantId));
  if (!job) return null;
  return { job, state: await job.getState() };
}

export interface EnqueueRepoJobArgs {
  kind: RepoJobKind;
  configId: number;
  tenantId?: string | null;
  /** Extra job data beside `configId` and `tenantId`. */
  data?: Record<string, unknown>;
  opts?: JobsOptions;
  /**
   * Runs after the queue was checked and before the job is added, so a
   * "queued" mark written here can never land after the worker's own
   * writes for the job.
   */
  beforeAdd?: () => Promise<void>;
}

export interface EnqueueRepoJobResult {
  jobId: string;
  /** True when a live job for the connection already existed and was joined. */
  joined: boolean;
}

/**
 * Queue one connection's job of a kind under its deterministic id. A live
 * job (queued or running) is joined instead of duplicated; a finished one
 * still held by retention is dropped first, since BullMQ would otherwise
 * hand the old job back and never run the new request.
 */
export async function enqueueRepoJob(
  queue: Pick<Queue, "getJob" | "add">,
  args: EnqueueRepoJobArgs
): Promise<EnqueueRepoJobResult> {
  const jobId = repoJobId(args.kind, args.configId, args.tenantId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (isLiveJobState(state)) return { jobId, joined: true };
    await existing.remove();
  }
  if (args.beforeAdd) await args.beforeAdd();
  const job = await queue.add(
    REPO_JOB_NAMES[args.kind],
    { configId: args.configId, tenantId: args.tenantId, ...args.data },
    { ...args.opts, jobId }
  );
  return { jobId: String(job.id ?? jobId), joined: false };
}
