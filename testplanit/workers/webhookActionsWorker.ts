import { Job, Worker } from "bullmq";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { JOB_DRAFT_CASES, WEBHOOK_ACTIONS_QUEUE_NAME } from "../lib/queueNames";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import {
  runDraftCases,
  type DraftCasesJob,
} from "../lib/webhooks/actions/draftCases";
import {
  runTrackerActions,
  type TrackerActionsJob,
} from "../lib/webhooks/actions/runTrackerActions";

/**
 * Inbound webhook actions: an issue-tracker delivery's rules (import the
 * issue, create test runs) run here, after the receiver has recorded and
 * answered the delivery. A job whose issue is mid-sync throws and retries.
 */
const processor = async (job: Job<TrackerActionsJob | DraftCasesJob>) => {
  validateMultiTenantJobData(job.data);
  const db = getDbClientForJob(job.data);
  if (job.name === JOB_DRAFT_CASES) {
    const drafted = await runDraftCases(db, job.data as DraftCasesJob);
    if (drafted.outcome === "cases_drafted") {
      console.log(
        `[WebhookActionsWorker] delivery ${job.data.deliveryId}: ${drafted.caseCount} case(s) drafted`
      );
    }
    return drafted;
  }
  const result = await runTrackerActions(db, job.data as TrackerActionsJob);
  if (result.outcome === "done" && result.runIds.length > 0) {
    console.log(
      `[WebhookActionsWorker] delivery ${job.data.deliveryId}: ${result.runIds.length} run(s) created`
    );
  }
  return result;
};

let worker: Worker | null = null;

const startWorker = async () => {
  console.log(
    `[WebhookActionsWorker] Starting in ${isMultiTenantMode() ? "MULTI" : "SINGLE"}-TENANT mode`
  );

  if (valkeyConnection) {
    worker = new Worker(
      WEBHOOK_ACTIONS_QUEUE_NAME,
      withTenantContext(processor),
      {
        connection: valkeyConnection as any,
        prefix: BULLMQ_PREFIX,
        concurrency: parseInt(
          process.env.WEBHOOK_ACTIONS_CONCURRENCY || "2",
          10
        ),
      }
    );

    worker.on("failed", (job, err) => {
      console.error(`[WebhookActionsWorker] Job ${job?.id} failed:`, err);
    });
    worker.on("error", (err) => {
      console.error("[WebhookActionsWorker] Worker error:", err);
    });

    console.log(
      `[WebhookActionsWorker] Started for queue "${WEBHOOK_ACTIONS_QUEUE_NAME}"`
    );
  } else {
    console.warn(
      "[WebhookActionsWorker] Valkey connection not available. Worker not started."
    );
  }

  const shutdown = async (signal: string) => {
    console.log(`[WebhookActionsWorker] Received ${signal}, shutting down...`);
    if (worker) await worker.close();
    if (isMultiTenantMode()) await disconnectAllTenantClients();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("[WebhookActionsWorker] Running as standalone process...");
  startWorker().catch((err) => {
    console.error("[WebhookActionsWorker] Failed to start:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
