import {
  FAILURE_TRIAGE_QUEUE_NAME,
  JOB_CLASSIFY_SIGNATURES,
  JOB_TRIAGE_BACKFILL,
  JOB_TRIAGE_RUN,
} from "~/lib/queueNames";
import { getFailureTriageQueue } from "~/lib/queues";
import type {
  ClassifySignaturesJobData,
  TriageBackfillJobData,
  TriageRunJobData,
} from "./types";

/**
 * A run's results arrive one row at a time (reporters) or in one burst
 * (imports); the per-run job is deduplicated for this long so a run is
 * triaged once per burst instead of once per result.
 */
export const TRIAGE_RUN_DELAY_MS = 10_000;

export function triageRunDedupId(testRunId: number, tenantId?: string): string {
  return `${FAILURE_TRIAGE_QUEUE_NAME}:run:${tenantId ?? "default"}:${testRunId}`;
}

export function triageBackfillJobId(
  projectId: number,
  tenantId?: string
): string {
  return `${FAILURE_TRIAGE_QUEUE_NAME}-backfill-${tenantId ?? "default"}-${projectId}`;
}

export async function enqueueFailureTriageForRun(
  data: TriageRunJobData
): Promise<void> {
  const queue = getFailureTriageQueue();
  if (!queue) return;
  try {
    await queue.add(JOB_TRIAGE_RUN, data, {
      deduplication: {
        id: triageRunDedupId(data.testRunId, data.tenantId),
        ttl: TRIAGE_RUN_DELAY_MS,
      },
      delay: TRIAGE_RUN_DELAY_MS,
      removeOnComplete: true,
    });
  } catch (error) {
    console.error(
      `[failure-triage] failed to queue run ${data.testRunId}:`,
      error
    );
  }
}

/** One backfill per project at a time; returns the job id, or null when a queue is unavailable. */
export async function enqueueFailureTriageBackfill(
  data: TriageBackfillJobData
): Promise<string | null> {
  const queue = getFailureTriageQueue();
  if (!queue) return null;
  const jobId = triageBackfillJobId(data.projectId, data.tenantId);
  const job = await queue.add(JOB_TRIAGE_BACKFILL, data, { jobId });
  return job.id ?? jobId;
}

export async function enqueueSignatureClassification(
  data: ClassifySignaturesJobData
): Promise<void> {
  const queue = getFailureTriageQueue();
  if (!queue || data.signatureIds.length === 0) return;
  try {
    await queue.add(JOB_CLASSIFY_SIGNATURES, data, { removeOnComplete: true });
  } catch (error) {
    console.error(`[failure-triage] failed to queue classification:`, error);
  }
}
