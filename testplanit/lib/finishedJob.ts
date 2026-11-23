import type { Job, Queue } from "bullmq";

/**
 * A status route reads a job and then its state. A job that finishes between
 * the two reads is reported as finished while the copy in hand still has no
 * result or failure reason. Returns a fresh copy in that case.
 */
export async function finishedJob(
  queue: Pick<Queue, "getJob">,
  job: Job,
  state: string
): Promise<Job> {
  const finished = state === "completed" || state === "failed";
  if (!finished || job.finishedOn != null || !job.id) {
    return job;
  }
  return ((await queue.getJob(job.id)) as Job | undefined) ?? job;
}
