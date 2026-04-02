import { Job, Worker } from "bullmq";
import {
  disconnectAllTenantClients,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { GENERATE_FROM_URL_QUEUE_NAME } from "../lib/queueNames";
import valkeyConnection from "../lib/valkey";

// ---- Job data / result types ----

export interface GenerateFromUrlJobData extends MultiTenantJobData {
  projectId: number;
  userId: string;
  url: string;
  options: {
    followLinks: boolean;
    maxDepth: number;
    maxPages: number;
  };
}

export interface GenerateFromUrlJobResult {
  testCases: unknown[];
  pagesProcessed: number;
  warnings: string[];
}

// ---- Cancel key ----

function cancelKey(jobId: string | undefined): string {
  return `generate-from-url:cancel:${jobId}`;
}

// ---- Processor ----

export const processor = async (
  job: Job<GenerateFromUrlJobData>,
  token?: string
): Promise<GenerateFromUrlJobResult> => {
  console.log(
    `Processing generate-from-url job ${job.id} for project ${job.data.projectId}` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );

  // 1. Validate multi-tenant context
  validateMultiTenantJobData(job.data);

  // 2. Check for pre-start cancellation
  const redis = await worker!.client;
  const cancelled = await redis.get(cancelKey(job.id));
  if (cancelled) {
    await redis.del(cancelKey(job.id));
    throw new Error("Job cancelled by user");
  }

  // 3. Report initial progress
  await job.updateProgress({ phase: "setup", message: "initializing" });

  // 4. Extend lock (demonstrates the pattern for Phase 62's page loop)
  await job.extendLock(token!, 60_000);

  // 5. Stub result — Phase 62 replaces this with actual crawl + extraction
  await job.updateProgress({
    phase: "complete",
    message: "stub_complete",
    pagesProcessed: 0,
    totalPages: 0,
  });

  return {
    testCases: [],
    pagesProcessed: 0,
    warnings: ["Stub worker — no crawl logic yet"],
  };
};

// ---- Worker setup ----

let worker: Worker<GenerateFromUrlJobData, GenerateFromUrlJobResult> | null =
  null;

export function startGenerateFromUrlWorker() {
  if (isMultiTenantMode()) {
    console.log("Generate-from-URL worker starting in MULTI-TENANT mode");
  } else {
    console.log("Generate-from-URL worker starting in SINGLE-TENANT mode");
  }

  worker = new Worker<GenerateFromUrlJobData, GenerateFromUrlJobResult>(
    GENERATE_FROM_URL_QUEUE_NAME,
    processor,
    {
      connection: valkeyConnection as any,
      concurrency: 1,
      lockDuration: 60_000,
      maxStalledCount: 1,
      stalledInterval: 30_000,
    }
  );

  worker.on("completed", (job) =>
    console.log(`Generate-from-URL job ${job.id} completed`)
  );
  worker.on("failed", (job, err) =>
    console.error(`Generate-from-URL job ${job?.id} failed:`, err.message)
  );
  worker.on("error", (err) => {
    console.error("Generate-from-URL worker error:", err);
  });

  console.log(
    `Generate-from-URL worker started for queue "${GENERATE_FROM_URL_QUEUE_NAME}".`
  );

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down generate-from-URL worker...");
    if (worker) await worker.close();
    if (isMultiTenantMode()) await disconnectAllTenantClients();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down generate-from-URL worker...");
    if (worker) await worker.close();
    if (isMultiTenantMode()) await disconnectAllTenantClients();
    process.exit(0);
  });

  return worker;
}

// Auto-start
startGenerateFromUrlWorker();
