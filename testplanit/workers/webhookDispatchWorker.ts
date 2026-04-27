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
import { retryDelayForAttempt } from "../lib/webhooks/retry-delay";

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

const processor = async (job: Job<DispatchJobData>) => {
  validateMultiTenantJobData(job.data);
  const prisma = getPrismaClientForJob(job.data);

  // Blocker 2 — thread the current attempt number from BullMQ into the job data.
  // job.attemptsMade is the count of COMPLETED attempts (0 on first run, 1 before
  // second run, ...). The current attempt is 1-indexed: attemptsMade + 1.
  // Verified against node_modules/bullmq/dist/cjs/classes/job.js:467-488.
  const currentAttempt = job.attemptsMade + 1;
  const jobDataWithAttempt: DispatchJobData = {
    ...job.data,
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

let worker: Worker | null = null;

const startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("[WebhookDispatchWorker] Starting in MULTI-TENANT mode");
  } else {
    console.log("[WebhookDispatchWorker] Starting in SINGLE-TENANT mode");
  }
  if (valkeyConnection) {
    worker = new Worker(WEBHOOK_DISPATCH_QUEUE_NAME, withTenantContext(processor), {
      connection: valkeyConnection as any,
      concurrency: parseInt(process.env.WEBHOOK_DISPATCH_CONCURRENCY || "5", 10),
      // OUT-01 retry curve — strategy MUST live on Worker.settings (Pitfall 6).
      // BullMQ 5.x signature: (attemptsMade, type?, err?, job?) => number | Promise<number>.
      // The `attemptsMade` here is `job.attemptsMade + 1` per BullMQ source (the
      // 1-indexed "next attempt about to start"). Plan 02-02's retryDelayForAttempt
      // is also 1-indexed — direct passthrough works.
      settings: {
        backoffStrategy: (attemptsMade: number) =>
          retryDelayForAttempt(attemptsMade),
      },
    });
    worker.on("completed", (_job) => {
      // silent — audit is the canonical record
    });
    worker.on("failed", (job, err) => {
      console.error(
        `[WebhookDispatchWorker] Job ${job?.id} failed (attempts=${job?.attemptsMade}):`,
        err
      );
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
