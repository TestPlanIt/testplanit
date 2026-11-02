import { DelayedError, Job, Worker } from "bullmq";
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
  IssueSyncBusyError,
  runTrackerActions,
  type TrackerActionsJob,
} from "../lib/webhooks/actions/runTrackerActions";

/**
 * How often a busy job can be rescheduled before a busy issue counts as an
 * ordinary failure and spends the job's retries.
 */
export const BUSY_RESCHEDULE_LIMIT = 20;
/**
 * A busy job waits a random 2–10s. Trackers send bursts of deliveries for one
 * issue, and identical backoff kept the whole burst colliding on the issue's
 * sync lock until every retry was spent; a spread lets them take turns.
 */
export const BUSY_DELAY_MIN_MS = 2000;
export const BUSY_DELAY_SPREAD_MS = 8000;

/**
 * Inbound webhook actions: an issue-tracker delivery's rules (import the
 * issue, create test runs) run here, after the receiver has recorded and
 * answered the delivery. A job whose issue is mid-sync is rescheduled
 * without spending a retry.
 */
const processor = async (
  job: Job<TrackerActionsJob | DraftCasesJob>,
  token?: string
) => {
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
  const data = job.data as TrackerActionsJob;
  let result;
  try {
    result = await runTrackerActions(db, data);
  } catch (error) {
    const busyCount = data.busyCount ?? 0;
    if (
      !(error instanceof IssueSyncBusyError) ||
      !token ||
      busyCount >= BUSY_RESCHEDULE_LIMIT
    ) {
      throw error;
    }
    await job.updateData({ ...data, busyCount: busyCount + 1 });
    await job.moveToDelayed(
      Date.now() + BUSY_DELAY_MIN_MS + Math.random() * BUSY_DELAY_SPREAD_MS,
      token
    );
    throw new DelayedError();
  }
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
