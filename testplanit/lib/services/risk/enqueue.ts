import {
  JOB_RISK_UPDATE_PROJECT,
  JOB_RISK_UPDATE_RUN,
  RISK_SCORE_QUEUE_NAME,
} from "~/lib/queueNames";
import { getRiskScoreQueue } from "~/lib/queues";
import type { RiskProjectJobData, RiskRunJobData } from "./types";

/**
 * A run's results arrive one row at a time (reporters) or in one burst
 * (imports); the per-run job is deduplicated for this long so the run's
 * cases are rescored once per burst instead of once per result.
 */
export const RISK_RUN_DELAY_MS = 10_000;

export function riskRunDedupId(testRunId: number, tenantId?: string): string {
  return `${RISK_SCORE_QUEUE_NAME}:run:${tenantId ?? "default"}:${testRunId}`;
}

export function riskProjectJobId(projectId: number, tenantId?: string): string {
  return `${RISK_SCORE_QUEUE_NAME}-project-${tenantId ?? "default"}-${projectId}`;
}

export async function enqueueRiskScoreForRun(
  data: RiskRunJobData
): Promise<void> {
  const queue = getRiskScoreQueue();
  if (!queue) return;
  try {
    await queue.add(JOB_RISK_UPDATE_RUN, data, {
      deduplication: {
        id: riskRunDedupId(data.testRunId, data.tenantId),
        ttl: RISK_RUN_DELAY_MS,
      },
      delay: RISK_RUN_DELAY_MS,
      removeOnComplete: true,
    });
  } catch (error) {
    console.error(`[risk-score] failed to queue run ${data.testRunId}:`, error);
  }
}

/** One full-project recompute at a time; null when the queue is unavailable. */
export async function enqueueRiskProjectRecompute(
  data: RiskProjectJobData
): Promise<string | null> {
  const queue = getRiskScoreQueue();
  if (!queue) return null;
  const jobId = riskProjectJobId(data.projectId, data.tenantId);
  const job = await queue.add(JOB_RISK_UPDATE_PROJECT, data, { jobId });
  return job.id ?? jobId;
}
