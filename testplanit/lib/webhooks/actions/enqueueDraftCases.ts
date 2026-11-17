import { getDbClientForJob } from "~/lib/multiTenantDb";
import { JOB_DRAFT_CASES } from "~/lib/queueNames";
import { getWebhookActionsQueue } from "~/lib/queues";
import { runDraftCases, type DraftCasesJob } from "./draftCases";
/**
 * Hand a Draft test cases rule's work to the worker on its own job, so the
 * model call never holds up the delivery's other rules. The job id keeps a
 * redelivered event from drafting twice.
 */
export async function enqueueDraftCases(job: DraftCasesJob): Promise<void> {
  const queue = getWebhookActionsQueue();
  if (queue) {
    await queue.add(JOB_DRAFT_CASES, job, {
      jobId: `draft-cases-${job.deliveryId}-${job.webhookActionId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 30000 },
    });
    return;
  }
  await runDraftCases(getDbClientForJob(job), job);
}
