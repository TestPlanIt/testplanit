import { Job, Worker } from "bullmq";
import { pathToFileURL } from "node:url";
import {
  disconnectAllTenantClients,
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { STEP_SCAN_QUEUE_NAME } from "../lib/queueNames";
import { StepSequenceScanService } from "../lib/services/stepSequenceScanService";
import { resolveSharedSteps } from "../lib/utils/resolveSharedSteps";
import valkeyConnection from "../lib/valkey";

// ─── Job data / result types ────────────────────────────────────────────────

export interface StepScanJobData extends MultiTenantJobData {
  projectId: number;
  folderId?: number;
  minSteps: number;
  userId: string;
}

export interface StepScanJobResult {
  matchesFound: number;
  casesScanned: number;
  cancelled: boolean;
  errors: Array<{ caseId: number; error: string }>;
}

// ─── Redis cancellation key helper ──────────────────────────────────────────

function cancelKey(jobId: string | undefined): string {
  return `step-scan:cancel:${jobId}`;
}

// ─── Core processor (exported for testing) ──────────────────────────────────

/**
 * Core step scan processor — extracted for testability.
 * Called by the BullMQ Worker processor with real clients,
 * or by tests directly with mocked clients.
 */
export async function processStepScan(
  job: Job<StepScanJobData>,
  prisma: any,
  redis: { get: (key: string) => Promise<string | null>; del: (key: string) => Promise<number> }
): Promise<StepScanJobResult> {
  console.log(
    `Processing step-scan job ${job.id} for project ${job.data.projectId}` +
      (job.data.folderId ? ` (folder: ${job.data.folderId})` : "") +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );

  // 1. Validate multi-tenant context
  validateMultiTenantJobData(job.data);

  // 2. Check for pre-start cancellation
  const cancelledAtStart = await redis.get(cancelKey(job.id));
  if (cancelledAtStart) {
    await redis.del(cancelKey(job.id));
    throw new Error("Job cancelled by user");
  }

  // 3. Fetch cases for the project (optionally scoped to a folder)
  const whereClause: any = {
    projectId: job.data.projectId,
    isDeleted: false,
    ...(job.data.folderId !== undefined ? { folderId: job.data.folderId } : {}),
  };

  const cases = await prisma.repositoryCases.findMany({
    where: whereClause,
    include: {
      steps: {
        where: { isDeleted: false },
        include: {
          sharedStepGroup: {
            include: {
              items: { orderBy: { order: "asc" } },
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });

  // 4. Resolve shared step placeholders BEFORE scanning (prevents false-positive matches)
  const resolvedCases = await resolveSharedSteps(cases as any[]);

  // 5. Report initial progress so the UI shows a progress bar immediately
  const totalPairs = (resolvedCases.length * (resolvedCases.length - 1)) / 2;
  await job.updateProgress({ analyzed: 0, total: totalPairs });

  // 6. Run the step sequence scan (check cancel key periodically during processing)
  const service = new StepSequenceScanService();
  const groups = await service.findSharedSequences(resolvedCases, job.data.minSteps, async (compared, total) => {
    await job.updateProgress({ analyzed: compared, total });
    // Check for mid-scan cancellation every 100 progress updates
    if (compared % 100 === 0) {
      const cancelled = await redis.get(cancelKey(job.id));
      if (cancelled) {
        await redis.del(cancelKey(job.id));
        throw new Error("Job cancelled by user");
      }
    }
  });

  // 6. Soft-delete old PENDING matches for this project (all prior scans)
  await prisma.stepSequenceMatch.updateMany({
    where: {
      projectId: job.data.projectId,
      status: "PENDING",
      isDeleted: false,
    },
    data: { isDeleted: true },
  });

  // 7. Persist new StepSequenceMatch and StepSequenceMatchCase rows
  for (const group of groups) {
    const match = await prisma.stepSequenceMatch.create({
      data: {
        projectId: job.data.projectId,
        fingerprint: group.fingerprint,
        stepCount: group.stepCount,
        scanJobId: job.id,
        isDeleted: false,
      },
    });

    await prisma.stepSequenceMatchCase.createMany({
      data: group.members.map((member) => ({
        matchId: match.id,
        caseId: member.caseId,
        startStepId: member.startStepId,
        endStepId: member.endStepId,
      })),
    });
  }

  // 8. Report progress
  await job.updateProgress({
    analyzed: cases.length,
    total: cases.length,
    matchesFound: groups.length,
  });

  console.log(
    `Step-scan job ${job.id} completed: matchesFound=${groups.length} casesScanned=${cases.length}`
  );

  return {
    matchesFound: groups.length,
    casesScanned: cases.length,
    cancelled: false,
    errors: [],
  };
}

// ─── Worker setup ────────────────────────────────────────────────────────────

let worker: Worker<StepScanJobData, StepScanJobResult> | null = null;

export function startStepSequenceScanWorker() {
  if (isMultiTenantMode()) {
    console.log("Step-scan worker starting in MULTI-TENANT mode");
  } else {
    console.log("Step-scan worker starting in SINGLE-TENANT mode");
  }

  if (!valkeyConnection) {
    console.warn("Valkey connection not available. Step-scan worker not started.");
    return null;
  }

  worker = new Worker<StepScanJobData, StepScanJobResult>(
    STEP_SCAN_QUEUE_NAME,
    async (job) => {
      const prisma = getPrismaClientForJob(job.data);
      const redis = await worker!.client;
      return processStepScan(job, prisma, redis);
    },
    {
      connection: valkeyConnection as any,
      concurrency: 1, // LOCKED: prevent ZenStack v3 deadlocks (40P01)
    }
  );

  worker.on("completed", (job) => {
    console.log(`Step-scan job ${job.id} completed successfully.`);
  });

  worker.on("failed", (job, err) => {
    console.error(`Step-scan job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("Step-scan worker error:", err);
  });

  console.log(`Step-scan worker started for queue "${STEP_SCAN_QUEUE_NAME}".`);

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down step-scan worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down step-scan worker...");
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

// Run the worker if this file is executed directly
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  typeof import.meta === "undefined" ||
  (import.meta as any).url === undefined
) {
  console.log("Step-scan worker running...");
  startStepSequenceScanWorker();
}

export default worker;
