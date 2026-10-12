import { getDbClientForJob } from "~/lib/multiTenantDb";
import { JOB_RUN_TRACKER_ACTIONS } from "~/lib/queueNames";
import { getWebhookActionsQueue } from "~/lib/queues";
import {
  IssueSyncBusyError,
  runTrackerActions,
  type TrackerActionsJob,
} from "./runTrackerActions";

/**
 * Hand an issue-tracker delivery's rules to the webhook-actions worker,
 * once per delivery. Without a queue (no Valkey) they run here instead.
 */
export async function enqueueTrackerActions(
  job: TrackerActionsJob
): Promise<void> {
  const queue = getWebhookActionsQueue();
  if (queue) {
    await queue.add(JOB_RUN_TRACKER_ACTIONS, job, {
      jobId: `tracker-actions-${job.deliveryId}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 5000 },
    });
    return;
  }
  try {
    await runTrackerActions(getDbClientForJob(job), job);
  } catch (error) {
    if (!(error instanceof IssueSyncBusyError)) throw error;
    console.warn(`[webhook-actions] ${error.message}; no queue to retry on`);
  }
}
