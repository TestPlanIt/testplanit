import { Job, Worker } from "bullmq";
import { pathToFileURL } from "node:url";
import {
  disconnectAllTenantClients, getPrismaClientForJob,
  isMultiTenantMode, validateMultiTenantJobData,
  type MultiTenantJobData
} from "../lib/multiTenantPrisma";
import { BUDGET_ALERT_QUEUE_NAME } from "../lib/queues";
import { BudgetAlertService } from "../lib/services/budgetAlertService";
import valkeyConnection from "../lib/valkey";

export const BUDGET_ALERT_JOB_CHECK = "check-budget";

interface BudgetCheckJobData extends MultiTenantJobData {
  llmIntegrationId: number;
}

/**
 * Process a budget alert check job.
 * Checks if any budget thresholds have been crossed and notifies admins.
 */
const processor = async (job: Job<BudgetCheckJobData>) => {
  console.log(
    `[BudgetAlertWorker] Processing job ${job.id} for integration ${job.data.llmIntegrationId}${
      job.data.tenantId ? ` tenant ${job.data.tenantId}` : ""
    }`
  );

  validateMultiTenantJobData(job.data);
  const prisma = getPrismaClientForJob(job.data);
  const service = new BudgetAlertService(prisma);

  await service.checkAndAlert(job.data.llmIntegrationId, job.data.tenantId);
};

let worker: Worker | null = null;

/**
 * Start the budget alert worker.
 */
const startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("[BudgetAlertWorker] Starting in MULTI-TENANT mode");
  } else {
    console.log("[BudgetAlertWorker] Starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    worker = new Worker(BUDGET_ALERT_QUEUE_NAME, processor, {
      connection: valkeyConnection as any,
      concurrency: parseInt(process.env.BUDGET_ALERT_CONCURRENCY || '2', 10),
    });

    worker.on("completed", (job) => {
      // Debug level - budget checks are frequent, don't log every completion
    });

    worker.on("failed", (job, err) => {
      console.error(`[BudgetAlertWorker] Job ${job?.id} failed:`, err);
    });

    worker.on("error", (err) => {
      console.error("[BudgetAlertWorker] Worker error:", err);
    });

    console.log(`[BudgetAlertWorker] Started for queue "${BUDGET_ALERT_QUEUE_NAME}"`);
  } else {
    console.warn(
      "[BudgetAlertWorker] Valkey connection not available. Worker not started."
    );
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("[BudgetAlertWorker] Shutting down...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("[BudgetAlertWorker] Received SIGTERM, shutting down...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};

// Run the worker if this file is executed directly
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  (typeof import.meta === "undefined" ||
    (import.meta as unknown as { url?: string })?.url === undefined)
) {
  console.log("[BudgetAlertWorker] Running as standalone process...");
  startWorker().catch((err) => {
    console.error("[BudgetAlertWorker] Failed to start:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
