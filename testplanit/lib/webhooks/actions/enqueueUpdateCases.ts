import { getDbClientForJob } from "~/lib/multiTenantDb";
import { JOB_UPDATE_CASES } from "~/lib/queueNames";
import { getWebhookActionsQueue } from "~/lib/queues";
import { runUpdateCases, type UpdateCasesJob } from "./updateCases";

/**
 * How long an issue's text must stay unchanged before its cases are checked.
 * Each new change to the issue restarts the wait, so a run of edits is
 * checked once, against the text they end on.
 */
export const UPDATE_CASES_SETTLE_MS = (() => {
  const configured = Number(process.env.WEBHOOK_UPDATE_CASES_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : 5 * 60 * 1000;
})();

export function updateCasesDedupId(job: UpdateCasesJob): string {
  return `update-cases-${job.tenantId ?? "default"}-${job.webhookActionId}-${job.issueId}`;
}

/**
 * Hand an Update test cases rule's work to the worker, once per rule and
 * issue however many deliveries arrive while the issue is still being edited:
 * a later delivery replaces the waiting job and restarts its delay.
 */
export async function enqueueUpdateCases(job: UpdateCasesJob): Promise<void> {
  const queue = getWebhookActionsQueue();
  if (queue) {
    await queue.add(JOB_UPDATE_CASES, job, {
      deduplication: {
        id: updateCasesDedupId(job),
        ttl: UPDATE_CASES_SETTLE_MS,
        extend: true,
        replace: true,
      },
      delay: UPDATE_CASES_SETTLE_MS,
      attempts: 3,
      backoff: { type: "exponential", delay: 30000 },
    });
    return;
  }
  await runUpdateCases(getDbClientForJob(job), job);
}
