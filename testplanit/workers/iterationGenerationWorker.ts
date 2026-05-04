import { Job, Worker } from "bullmq";
import {
  disconnectAllTenantClients,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { ITERATION_GENERATION_QUEUE_NAME } from "../lib/queueNames";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";

// ─── Job data / result types ────────────────────────────────────────────────

export interface IterationGenerationJobData extends MultiTenantJobData {
  testRunId: number;
  userId: string;
}

export interface IterationGenerationJobResult {
  iterationCount: number;
  testRunId: number;
}

// ─── Processor ──────────────────────────────────────────────────────────────
// Real fan-out logic lands in a follow-up wave. This stub guards against
// accidental enqueue: any job that reaches this processor fails loudly so the
// caller is forced to acknowledge the missing implementation.

export const processor = async (
  job: Job<IterationGenerationJobData>
): Promise<IterationGenerationJobResult> => {
  console.log(
    `Processing iteration generation job ${job.id} for test run ${job.data.testRunId}` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );

  // Validate multi-tenant context so any future invocation that bypasses
  // validateMultiTenantJobData at the enqueue site still fails loudly here.
  validateMultiTenantJobData(job.data);

  throw new Error("not yet implemented");
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
