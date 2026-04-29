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
import {
  dispatchWebhook,
  type DispatchJobData,
} from "../lib/webhooks/dispatch";
import { transition as transitionHealth } from "../lib/webhooks/health";
import { retryDelayForAttempt } from "../lib/webhooks/retry-delay";
import { retireExpiredSecrets } from "../lib/webhooks/secret-rotation";

/**
 * v0.23.0 Phase 2 (OUT-10) — outbound webhook dispatch worker.
 *
 * Consumes webhookDispatchQueue jobs, calls lib/webhooks/dispatch.ts, throws
 * on non-2xx so BullMQ retries on the OUT-01 schedule (0s, 30s, 5m, 30m, 2h,
 * 6h, 12h). Custom backoff strategy is registered HERE (on Worker.settings),
 * not on the Queue (RESEARCH Pitfall 6).
 *
 * Blocker 2 fix — attempt threading: the original `attempt: 1` value placed
 * on `job.data` by the outbox poller does NOT change between retries. BullMQ
 * tracks retry count via `job.attemptsMade` (incremented when a prior attempt
 * completed). The processor below overrides `jobData.attempt = job.attemptsMade + 1`
 * BEFORE calling dispatchWebhook so each WebhookDelivery row carries the correct
 * 1-indexed attempt number per OUT-03.
 */

const processor = async (job: Job<DispatchJobData | { tenantId?: string }>) => {
  // Plan 02-06 / Task 6.3 — daily auto-retire cron job. The scheduler upserts
  // a job named "retire-expired-secrets" onto this queue once per day per
  // tenant; we short-circuit BEFORE multi-tenant validation because the cron
  // job's data shape is just `{ tenantId? }` (no outboxEventId/webhookConfigId).
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

  // Blocker 2 — thread the current attempt number from BullMQ into the job data.
  // job.attemptsMade is the count of COMPLETED attempts (0 on first run, 1 before
  // second run, ...). The current attempt is 1-indexed: attemptsMade + 1.
  // Verified against node_modules/bullmq/dist/cjs/classes/job.js:467-488.
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
  } catch (err) {
    // Re-throw so BullMQ retries per OUT-01 schedule.
    console.warn(
      `[WebhookDispatchWorker] Job ${job.id} attempt ${currentAttempt} failed:`,
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  }
};

/**
 * Plan 04-05 / Task 5.3 — BullMQ worker hooks bridging dispatch outcomes
 * into the health state machine (lib/webhooks/health.ts).
 *
 * Locked seam (CONTEXT D-10):
 *  - on('completed') → transition(configId, 'success'). Counter resets to 0;
 *    DEGRADED/DISABLED auto-recover to HEALTHY.
 *  - on('failed') is fired by BullMQ on EVERY attempt failure (including
 *    retries). The counter is event-level, NOT attempt-level: only
 *    transitionHealth on terminal failure (job.attemptsMade + 1 >= maxAttempts).
 *    Phase 2 D-21 sets attempts=7; transient retries don't tick the counter.
 *
 * Both handlers are exported so they're directly testable without spinning
 * up a real BullMQ Worker against valkey.
 */
export async function handleCompleted(job: Job): Promise<void> {
  const webhookConfigId = (job?.data as { webhookConfigId?: string } | null)
    ?.webhookConfigId;
  if (!webhookConfigId) return;
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
    worker = new Worker(
      WEBHOOK_DISPATCH_QUEUE_NAME,
      withTenantContext(processor),
      {
        connection: valkeyConnection as any,
        concurrency: parseInt(
          process.env.WEBHOOK_DISPATCH_CONCURRENCY || "5",
          10
        ),
        // OUT-01 retry curve — strategy MUST live on Worker.settings (Pitfall 6).
        // BullMQ 5.x signature: (attemptsMade, type?, err?, job?) => number | Promise<number>.
        // The `attemptsMade` here is `job.attemptsMade + 1` per BullMQ source (the
        // 1-indexed "next attempt about to start"). Plan 02-02's retryDelayForAttempt
        // is also 1-indexed — direct passthrough works.
        settings: {
          backoffStrategy: (attemptsMade: number) =>
            retryDelayForAttempt(attemptsMade),
        },
      }
    );
    worker.on("completed", (job) => {
      // Plan 04-05 / Task 5.3 — handleCompleted writes lastSuccessAt +
      // resets consecutiveFailureCount + flips DEGRADED/DISABLED → HEALTHY
      // via lib/webhooks/health.transition.
      void handleCompleted(job);
    });
    worker.on("failed", (job, err) => {
      // Plan 04-05 / Task 5.3 — handleFailed is no-op for non-terminal
      // failures (CONTEXT D-10 event-level counter); on terminal failure
      // it bumps consecutiveFailureCount and may flip DEGRADED → DISABLED.
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
