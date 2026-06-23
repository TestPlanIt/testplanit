import { Job, Worker } from "bullmq";

import {
  disconnectAllTenantClients,
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { ITERATION_GENERATION_QUEUE_NAME } from "../lib/queueNames";
import { materializeIterations } from "../lib/services/iterationFanOut";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";

// ─── Job data / result types ────────────────────────────────────────────────

export interface IterationGenerationJobData extends MultiTenantJobData {
  testRunId: number;
  userId: string;
}

export interface IterationGenerationJobResult {
  iterationCount: number;
  testRunId: number;
  parameterizedRunCaseCount: number;
}

// ─── Processor ──────────────────────────────────────────────────────────────
// Wraps materializeIterations() in a single transaction with an extended
// timeout (5 min) for very large fan-outs. attempts: 1 in the queue config
// guarantees no retry — if this throws, the job stays in failed state
// forever and the iteration tree is left empty (atomic create-or-fail per
// Phase 3 success criterion 4).
//
// Progress is emitted via job.updateProgress() at the cadence chosen by
// materializeIterations (every 50 cases by default — far less noisy than
// every iteration row).

const TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const TRANSACTION_MAX_WAIT_MS = 30 * 1000; // 30 seconds to acquire connection

export const processor = async (
  job: Job<IterationGenerationJobData>
): Promise<IterationGenerationJobResult> => {
  console.log(
    `Processing iteration generation job ${job.id} for test run ${job.data.testRunId}` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );

  // Validate multi-tenant context. Throws if missing in multi-tenant mode.
  validateMultiTenantJobData(job.data);

  const prisma = getPrismaClientForJob(job.data);

  // Initial progress so the polling endpoint sees something other than
  // an empty progress object on the very first read.
  await job.updateProgress({ processed: 0, total: 0, phase: "starting" });

  const result = await prisma.$transaction(
    async (tx: any) => {
      return materializeIterations(job.data.testRunId, tx, {
        progressIntervalCases: 50,
        onProgress: async ({ processedCases, totalCases, iterationsSoFar }) => {
          await job.updateProgress({
            processed: processedCases,
            total: totalCases,
            iterationsSoFar,
            phase: "materializing",
          });
        },
      });
    }
  );

  // Emit a final completion progress event so polling clients see the
  // final tally before they query state and pick up the return value.
  await job.updateProgress({
    processed: result.parameterizedRunCaseCount,
    total: result.parameterizedRunCaseCount,
    iterationsSoFar: result.iterationCount,
    phase: "complete",
  });

  // NOTE: No NotificationService.createNotification call here.
  //
  // Phase 3 Wave 1 deliberately defers the bell-notification wake-up. Adding
  // a new NotificationType (e.g., ITERATION_GENERATION_COMPLETE) would also
  // require updating components/NotificationContent.tsx + workers/emailWorker.ts
  // plus i18n keys per feedback_localize_new_notifications. The polling-based
  // status endpoint (GET /api/test-runs/iterations/status/[jobId]) is the
  // primary UX path for completion detection. A future wave can add the
  // notification surface without changing this worker's contract.

  return {
    iterationCount: result.iterationCount,
    testRunId: job.data.testRunId,
    parameterizedRunCaseCount: result.parameterizedRunCaseCount,
  };
};

// ─── Worker setup ───────────────────────────────────────────────────────────

let worker: Worker<
  IterationGenerationJobData,
  IterationGenerationJobResult
> | null = null;

export function startIterationGenerationWorker() {
  if (isMultiTenantMode()) {
    console.log("Iteration generation worker starting in MULTI-TENANT mode");
  } else {
    console.log("Iteration generation worker starting in SINGLE-TENANT mode");
  }

  worker = new Worker<IterationGenerationJobData, IterationGenerationJobResult>(
    ITERATION_GENERATION_QUEUE_NAME,
    withTenantContext(processor),
    {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) =>
    console.log(`Iteration generation job ${job.id} completed`)
  );
  worker.on("failed", (job, err) =>
    console.error(`Iteration generation job ${job?.id} failed:`, err.message)
  );
  worker.on("error", (err) => {
    console.error("Iteration generation worker error:", err);
  });

  console.log(
    `Iteration generation worker started for queue "${ITERATION_GENERATION_QUEUE_NAME}".`
  );

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down iteration generation worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down iteration generation worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  return worker;
}

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("Iteration generation worker running...");
  startIterationGenerationWorker();
}

export default worker;
