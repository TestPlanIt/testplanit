/**
 * Enqueue side of alerts (#651).
 *
 * The side-effect plugin calls these from inside the writer's transaction,
 * so they must never throw into the caller and must never hold the
 * transaction open: a Valkey hiccup is logged, not surfaced to the result
 * writer. Evaluation itself runs in `workers/alertWorker.ts`.
 */

import {
  JOB_EVALUATE_ALERT_JUNIT_RESULT,
  JOB_EVALUATE_ALERT_RESULT,
  JOB_EVALUATE_ALERT_RUN,
} from "~/lib/queueNames";
import { getAlertQueue } from "~/lib/queues";

/**
 * The worker reads committed state, and the hook that enqueues runs inside
 * the writer's transaction, so evaluation is deferred by this much.
 */
export const ALERT_EVALUATION_DELAY_MS = 3000;

export interface AlertResultJobData {
  resultId: number;
  projectId: number;
  tenantId?: string;
}

export interface AlertJUnitResultJobData {
  junitResultId: number;
  projectId: number;
  tenantId?: string;
}

export type AlertRunTrigger = "result" | "completion";

export interface AlertRunJobData {
  runId: number;
  projectId: number;
  trigger: AlertRunTrigger;
  tenantId?: string;
}

export interface AlertScheduledJobData {
  tenantId?: string;
}

interface RuleCountClient {
  alertRule: {
    count: (args: { where: Record<string, unknown> }) => Promise<number>;
  };
}

/**
 * Cheap gate for the hooks: a project with no enabled rule never enqueues,
 * so busy automated runs in projects that do not use the feature cost
 * nothing beyond one indexed count per write.
 */
export async function projectHasActiveAlertRules(
  db: RuleCountClient,
  projectId: number
): Promise<boolean> {
  try {
    const count = await db.alertRule.count({
      where: { projectId, isEnabled: true, isDeleted: false },
    });
    return count > 0;
  } catch (error) {
    console.error(
      `[alertEnqueue] failed to count rules for project ${projectId}:`,
      error
    );
    return false;
  }
}

export function alertRunDedupId(
  runId: number,
  trigger: AlertRunTrigger,
  tenantId: string | undefined
): string {
  return `alert-run:${tenantId ?? "default"}:${runId}:${trigger}`;
}

export async function enqueueAlertResultEvaluation(
  data: AlertResultJobData
): Promise<void> {
  const queue = getAlertQueue();
  if (!queue) return;
  try {
    await queue.add(JOB_EVALUATE_ALERT_RESULT, data, {
      delay: ALERT_EVALUATION_DELAY_MS,
      removeOnComplete: true,
    });
  } catch (error) {
    console.error(
      `[alertEnqueue] failed to queue evaluation for result ${data.resultId}:`,
      error
    );
  }
}

export async function enqueueAlertJUnitResultEvaluation(
  data: AlertJUnitResultJobData
): Promise<void> {
  const queue = getAlertQueue();
  if (!queue) return;
  try {
    await queue.add(JOB_EVALUATE_ALERT_JUNIT_RESULT, data, {
      delay: ALERT_EVALUATION_DELAY_MS,
      removeOnComplete: true,
    });
  } catch (error) {
    console.error(
      `[alertEnqueue] failed to queue evaluation for automated result ${data.junitResultId}:`,
      error
    );
  }
}

/**
 * Run-level evaluation. Deduplicated per run and trigger while a job is
 * queued, so a bulk submission touching hundreds of cases evaluates once.
 */
export async function enqueueAlertRunEvaluation(
  data: AlertRunJobData
): Promise<void> {
  const queue = getAlertQueue();
  if (!queue) return;
  try {
    await queue.add(JOB_EVALUATE_ALERT_RUN, data, {
      deduplication: {
        id: alertRunDedupId(data.runId, data.trigger, data.tenantId),
        ttl: ALERT_EVALUATION_DELAY_MS,
      },
      delay: ALERT_EVALUATION_DELAY_MS,
      removeOnComplete: true,
    });
  } catch (error) {
    console.error(
      `[alertEnqueue] failed to queue run evaluation for run ${data.runId}:`,
      error
    );
  }
}
