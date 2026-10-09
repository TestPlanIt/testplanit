import { Job, Worker } from "bullmq";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import {
  JOB_EVALUATE_SCHEDULED_ALERTS,
  JOB_EVALUATE_HOURLY_ALERTS,
  JOB_EVALUATE_ALERT_EXECUTION,
  JOB_EVALUATE_ALERT_JUNIT_RESULT,
  JOB_EVALUATE_ALERT_RESULT,
  JOB_EVALUATE_ALERT_RUN,
  JOB_EVALUATE_ALERT_SESSION,
  ALERT_QUEUE_NAME,
} from "../lib/queueNames";
import { AlertEvaluationService } from "../lib/services/alertEvaluation";
import type {
  AlertExecutionJobData,
  AlertJUnitResultJobData,
  AlertResultJobData,
  AlertRunJobData,
  AlertScheduledJobData,
  AlertSessionJobData,
} from "../lib/services/alertEnqueue";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";

type ThresholdJobData =
  | AlertResultJobData
  | AlertJUnitResultJobData
  | AlertRunJobData
  | AlertScheduledJobData;

/**
 * Alert evaluation (#651). Event-driven jobs arrive from the
 * result/run side-effect hooks; the scheduled job arrives from the scheduler
 * once a day. Every job resolves the tenant client itself, so multi-tenant
 * evaluation follows the same pattern as the other workers.
 */
const processor = async (job: Job<ThresholdJobData>) => {
  validateMultiTenantJobData(job.data as { tenantId?: string });
  const db = getDbClientForJob(job.data as { tenantId?: string });
  const service = new AlertEvaluationService(db);
  const tenantId = (job.data as { tenantId?: string }).tenantId;

  switch (job.name) {
    case JOB_EVALUATE_ALERT_RESULT: {
      const data = job.data as AlertResultJobData;
      const fired = await service.evaluateResult(data.resultId, tenantId);
      if (fired.length > 0) {
        console.log(
          `[AlertWorker] result ${data.resultId}: ${fired.length} rule(s) fired`
        );
      }
      break;
    }
    case JOB_EVALUATE_ALERT_JUNIT_RESULT: {
      const data = job.data as AlertJUnitResultJobData;
      const fired = await service.evaluateJUnitResult(
        data.junitResultId,
        tenantId
      );
      if (fired.length > 0) {
        console.log(
          `[AlertWorker] automated result ${data.junitResultId}: ${fired.length} rule(s) fired`
        );
      }
      break;
    }
    case JOB_EVALUATE_ALERT_RUN: {
      const data = job.data as AlertRunJobData;
      const fired = await service.evaluateRun(
        data.runId,
        data.trigger,
        tenantId
      );
      if (fired.length > 0) {
        console.log(
          `[AlertWorker] run ${data.runId} (${data.trigger}): ${fired.length} rule(s) fired`
        );
      }
      break;
    }
    case JOB_EVALUATE_ALERT_EXECUTION: {
      const data = job.data as AlertExecutionJobData;
      const fired = await service.evaluateExecution(data.executionId, tenantId);
      if (fired.length > 0) {
        console.log(
          `[AlertWorker] execution ${data.executionId}: ${fired.length} rule(s) fired`
        );
      }
      break;
    }
    case JOB_EVALUATE_ALERT_SESSION: {
      const data = job.data as AlertSessionJobData;
      const fired = await service.evaluateSession(data.sessionId, tenantId);
      if (fired.length > 0) {
        console.log(
          `[AlertWorker] session ${data.sessionId}: ${fired.length} rule(s) fired`
        );
      }
      break;
    }
    case JOB_EVALUATE_SCHEDULED_ALERTS: {
      const fired = await service.evaluateScheduled(tenantId, "daily");
      console.log(
        `[AlertWorker] daily pass${tenantId ? ` (tenant ${tenantId})` : ""}: ${fired.length} rule(s) fired`
      );
      break;
    }
    case JOB_EVALUATE_HOURLY_ALERTS: {
      const fired = await service.evaluateScheduled(tenantId, "hourly");
      if (fired.length > 0) {
        console.log(
          `[AlertWorker] hourly pass${tenantId ? ` (tenant ${tenantId})` : ""}: ${fired.length} rule(s) fired`
        );
      }
      break;
    }
    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
};

let worker: Worker | null = null;

const startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("[AlertWorker] Starting in MULTI-TENANT mode");
  } else {
    console.log("[AlertWorker] Starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    worker = new Worker(ALERT_QUEUE_NAME, withTenantContext(processor), {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: parseInt(process.env.ALERT_CONCURRENCY || "2", 10),
    });

    worker.on("failed", (job, err) => {
      console.error(`[AlertWorker] Job ${job?.id} failed:`, err);
    });

    worker.on("error", (err) => {
      console.error("[AlertWorker] Worker error:", err);
    });

    console.log(`[AlertWorker] Started for queue "${ALERT_QUEUE_NAME}"`);
  } else {
    console.warn(
      "[AlertWorker] Valkey connection not available. Worker not started."
    );
  }

  const shutdown = async (signal: string) => {
    console.log(`[AlertWorker] Received ${signal}, shutting down...`);
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("[AlertWorker] Running as standalone process...");
  startWorker().catch((err) => {
    console.error("[AlertWorker] Failed to start:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
