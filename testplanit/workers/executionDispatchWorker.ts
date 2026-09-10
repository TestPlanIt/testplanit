import { Job, Worker } from "bullmq";

import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import {
  dispatchExecution,
  pollActiveExecutions,
} from "../lib/execution/dispatch";
import {
  EXECUTION_DISPATCH_QUEUE_NAME,
  JOB_DISPATCH_EXECUTION,
  JOB_POLL_ACTIVE_EXECUTIONS,
} from "../lib/queueNames";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";

/**
 * Automated-execution dispatch worker.
 *
 * Two job kinds on the execution-dispatch queue:
 *   - dispatch-execution `{ executionId, tenantId? }` — start the CI job for
 *     one PENDING TestRunExecution. Never retried by BullMQ: starting a job
 *     twice is worse than recording DISPATCH_FAILED and letting a person
 *     retry from the run page.
 *   - poll-active-executions `{ tenantId? }` — scheduler cron (every minute)
 *     that asks each provider for the state of in-flight executions and
 *     times out the ones that never reported back.
 *
 * Both run inside tenant context: dispatch and polling decrypt target
 * credentials, which needs the tenant's ENCRYPTION_KEY.
 */

export interface DispatchExecutionJobData {
  executionId: number;
  tenantId?: string;
}

const processor = async (
  job: Job<DispatchExecutionJobData | { tenantId?: string }>
) => {
  if (job.name === JOB_POLL_ACTIVE_EXECUTIONS) {
    const db = getDbClientForJob(job.data as { tenantId?: string });
    const summary = await pollActiveExecutions(db, {
      tenantId: (job.data as { tenantId?: string }).tenantId,
    });
    if (
      summary.polled + summary.finished + summary.timedOut + summary.stalled >
      0
    ) {
      console.log(
        `[ExecutionDispatchWorker] Poll: ${summary.polled} polled, ${summary.finished} finished, ${summary.timedOut} timed out, ${summary.stalled} stalled`
      );
    }
    return summary;
  }

  validateMultiTenantJobData(job.data as DispatchExecutionJobData);
  const data = job.data as DispatchExecutionJobData;
  const db = getDbClientForJob(data);
  console.log(
    `[ExecutionDispatchWorker] Job ${job.id}: dispatching execution ${data.executionId}`
  );
  const outcome = await dispatchExecution(db, data.executionId, {
    tenantId: data.tenantId,
  });
  console.log(
    `[ExecutionDispatchWorker] Job ${job.id}: execution ${data.executionId} → ${outcome.outcome}`
  );
  return outcome;
};

export const dispatch = withTenantContext(processor);

let worker: Worker | null = null;

const startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("[ExecutionDispatchWorker] Starting in MULTI-TENANT mode");
  } else {
    console.log("[ExecutionDispatchWorker] Starting in SINGLE-TENANT mode");
  }
  if (valkeyConnection) {
    worker = new Worker(EXECUTION_DISPATCH_QUEUE_NAME, dispatch, {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: parseInt(
        process.env.EXECUTION_DISPATCH_CONCURRENCY || "3",
        10
      ),
    });
    worker.on("failed", (job, err) => {
      console.error(
        `[ExecutionDispatchWorker] Job ${job?.id} (${job?.name}) failed:`,
        err instanceof Error ? err.message : String(err)
      );
    });
    worker.on("error", (err) => {
      console.error("[ExecutionDispatchWorker] Worker error:", err);
    });
    console.log(
      `[ExecutionDispatchWorker] Started for queue "${EXECUTION_DISPATCH_QUEUE_NAME}" (jobs: ${JOB_DISPATCH_EXECUTION}, ${JOB_POLL_ACTIVE_EXECUTIONS})`
    );
  } else {
    console.warn(
      "[ExecutionDispatchWorker] Valkey connection not available. Worker not started."
    );
  }

  process.on("SIGINT", async () => {
    console.log("[ExecutionDispatchWorker] Shutting down...");
    if (worker) await worker.close();
    if (isMultiTenantMode()) await disconnectAllTenantClients();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    console.log("[ExecutionDispatchWorker] Received SIGTERM, shutting down...");
    if (worker) await worker.close();
    if (isMultiTenantMode()) await disconnectAllTenantClients();
    process.exit(0);
  });
};

if (require.main === module) {
  console.log("[ExecutionDispatchWorker] Running as standalone process...");
  startWorker().catch((err) => {
    console.error("[ExecutionDispatchWorker] Failed to start:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
