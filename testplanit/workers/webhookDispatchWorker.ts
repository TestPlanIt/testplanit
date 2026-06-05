import { Job, Worker } from "bullmq";

import {
  disconnectAllTenantClients,
  getPrismaClientForJob,
  isMultiTenantMode,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { WEBHOOK_DISPATCH_QUEUE_NAME } from "../lib/queues";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import {
  dispatchWebhook,
  type DispatchJobData,
} from "../lib/webhooks/dispatch";
import { transition as transitionHealth } from "../lib/webhooks/health";
import { retryDelayForAttempt } from "../lib/webhooks/retry-delay";
import { retireExpiredSecrets } from "../lib/webhooks/secret-rotation";

/**
 * outbound webhook dispatch worker.
 *
 * Consumes webhookDispatchQueue jobs, calls lib/webhooks/dispatch.ts, throws
 * on non-2xx so BullMQ retries on the retry schedule (0s, 30s, 5m, 30m, 2h,
 * 6h, 12h). Custom backoff strategy is registered HERE (on Worker.settings),
 * not on the Queue.
 *
 * Attempt threading: the original `attempt: 1` value placed on `job.data` by
 * the outbox poller does NOT change between retries. BullMQ tracks retry
 * count via `job.attemptsMade` (incremented when a prior attempt completed).
 * The processor below overrides `jobData.attempt = job.attemptsMade + 1`
 * BEFORE calling dispatchWebhook so each WebhookDelivery row carries the
 * correct 1-indexed attempt number.
 */

const processor = async (job: Job<DispatchJobData | { tenantId?: string }>) => {
  // Daily auto-retire cron job. The scheduler upserts a job named
  // "retire-expired-secrets" onto this queue once per day per tenant; we
  // short-circuit BEFORE multi-tenant validation because the cron job's
  // data shape is just `{ tenantId? }` (no outboxEventId/webhookConfigId).
  if (job.name === "retire-expired-secrets") {
    const prisma = getPrismaClientForJob(job.data as { tenantId?: string });
    const { retiredCount } = await retireExpiredSecrets(prisma);
    console.log(
      `[WebhookDispatchWorker] Retired ${retiredCount} expired WebhookConfigSecret rows`
    );
    return;
  }

  validateMultiTenantJobData(job.data as DispatchJobData);
  const prisma = getPrismaClientForJob(job.data as DispatchJobData);

  // Thread the current attempt number from BullMQ into the job data.
  // job.attemptsMade is the count of COMPLETED attempts (0 on first run, 1
  // before second run, ...). The current attempt is 1-indexed:
  // attemptsMade + 1. Verified against
  // node_modules/bullmq/dist/cjs/classes/job.js:467-488.
  const currentAttempt = job.attemptsMade + 1;
  const jobDataWithAttempt: DispatchJobData = {
    ...(job.data as DispatchJobData),
    attempt: currentAttempt,
  };

  console.log(
    `[WebhookDispatchWorker] Job ${job.id} attempt ${currentAttempt} for config ${jobDataWithAttempt.webhookConfigId}, event ${jobDataWithAttempt.outboxEventId}`
  );
  try {
    const outcome = await dispatchWebhook(jobDataWithAttempt, prisma);
    console.log(
      `[WebhookDispatchWorker] Job ${job.id} outcome: ${outcome.outcome}`
    );
    // Return the outcome shape so worker.on('completed', (job, result) => ...)
    // can distinguish a real HTTP 2xx success from a short-circuit (DISABLED
    // gate, skipped_inactive, skipped_unsubscribed). Only real successes
    // should reset endpointHealth via health.transition('success').
    return outcome;
  } catch (err) {
    // Re-throw so BullMQ retries per the retry schedule.
    console.warn(
      `[WebhookDispatchWorker] Job ${job.id} attempt ${currentAttempt} failed:`,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
};

// Queue-level dispatch wrapper. retire-expired-secrets resolves its own
// tenant-scoped Prisma client from job.data and decrypts nothing, so it must
// NOT go through withTenantContext: that wrapper eagerly fetches the tenant
// ENCRYPTION_KEY from the Kubernetes secrets API for every job with a
// tenantId. For this cron the key is unnecessary, and the fetch throws (then
// retries forever) for tenants whose secret is absent or unreadable. All
// other jobs still run inside tenant context.
const contextAwareProcessor = withTenantContext(processor);

export const dispatch = (
  job: Job<DispatchJobData | { tenantId?: string }>
): Promise<unknown> =>
  job.name === "retire-expired-secrets"
    ? processor(job)
    : contextAwareProcessor(job);

export async function handleCompleted(
  job: Job,
  result?: { outcome?: string } | null
): Promise<void> {
  const webhookConfigId = (job?.data as { webhookConfigId?: string } | null)
    ?.webhookConfigId;
  if (!webhookConfigId) return;
  // Only ACTUAL HTTP successes reset endpointHealth. Short-circuit outcomes
  // (DISABLED gate writing endpoint_disabled, skipped_inactive,
  // skipped_unsubscribed) are NOT signals that the endpoint recovered —
  // calling health.transition('success') on those would undo the auto-disable
  // (DISABLED → HEALTHY) immediately after the gate kept us from firing.
  if (result?.outcome !== "success") return;
  try {
    await transitionHealth(webhookConfigId, "success");
  } catch (err) {
    console.error(
      `[WebhookDispatchWorker] health transition (success) failed for config ${webhookConfigId}:`,
      err
    );
  }
}

export async function handleFailed(
  job: Job | undefined,
  err: Error
): Promise<void> {
  if (!job) return;
  const webhookConfigId = (job.data as { webhookConfigId?: string } | null)
    ?.webhookConfigId;
  if (!webhookConfigId) return;
  const maxAttempts = job.opts?.attempts ?? 1;
  const isTerminal = job.attemptsMade + 1 >= maxAttempts;
  console.error(
    `[WebhookDispatchWorker] Job ${job.id} failed (attempts=${job.attemptsMade}, terminal=${isTerminal}):`,
    err
  );
  if (!isTerminal) return;
  try {
    await transitionHealth(webhookConfigId, "failure");
  } catch (transitionErr) {
    console.error(
      `[WebhookDispatchWorker] health transition (failure) failed for config ${webhookConfigId}:`,
      transitionErr
    );
  }
}

let worker: Worker | null = null;

const startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("[WebhookDispatchWorker] Starting in MULTI-TENANT mode");
  } else {
    console.log("[WebhookDispatchWorker] Starting in SINGLE-TENANT mode");
  }
  if (valkeyConnection) {
    worker = new Worker(WEBHOOK_DISPATCH_QUEUE_NAME, dispatch, {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: parseInt(
        process.env.WEBHOOK_DISPATCH_CONCURRENCY || "5",
        10
      ),
      // Retry curve — strategy MUST live on Worker.settings (not Queue).
      // BullMQ 5.x signature: (attemptsMade, type?, err?, job?) => number | Promise<number>.
      // The `attemptsMade` here is `job.attemptsMade + 1` per BullMQ source
      // (the 1-indexed "next attempt about to start"). retryDelayForAttempt
      // is also 1-indexed — direct passthrough works.
      settings: {
        backoffStrategy: (attemptsMade: number) =>
          retryDelayForAttempt(attemptsMade),
      },
    });
    worker.on("completed", (job, result) => {
      // handleCompleted writes lastSuccessAt + resets consecutiveFailureCount
      // + flips DEGRADED/DISABLED → HEALTHY via lib/webhooks/health.transition.
      // Only fires for ACTUAL HTTP 2xx outcomes; DISABLED-gate / skipped
      // short-circuits are no-op.
      void handleCompleted(job, result as { outcome?: string } | null);
    });
    worker.on("failed", (job, err) => {
      // handleFailed is no-op for non-terminal failures (event-level
      // counter); on terminal failure it bumps consecutiveFailureCount and
      // may flip DEGRADED → DISABLED.
      void handleFailed(job, err);
    });
    worker.on("error", (err) => {
      console.error("[WebhookDispatchWorker] Worker error:", err);
    });
    console.log(
      `[WebhookDispatchWorker] Started for queue "${WEBHOOK_DISPATCH_QUEUE_NAME}"`
    );
  } else {
    console.warn(
      "[WebhookDispatchWorker] Valkey connection not available. Worker not started."
    );
  }

  process.on("SIGINT", async () => {
    console.log("[WebhookDispatchWorker] Shutting down...");
    if (worker) await worker.close();
    if (isMultiTenantMode()) await disconnectAllTenantClients();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    console.log("[WebhookDispatchWorker] Received SIGTERM, shutting down...");
    if (worker) await worker.close();
    if (isMultiTenantMode()) await disconnectAllTenantClients();
    process.exit(0);
  });
};

if (require.main === module) {
  console.log("[WebhookDispatchWorker] Running as standalone process...");
  startWorker().catch((err) => {
    console.error("[WebhookDispatchWorker] Failed to start:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
