import { Job, Worker } from "bullmq";
import { pathToFileURL } from "node:url";
import { DuplicateScanService } from "../lib/services/duplicateScanService";
import {
  disconnectAllTenantClients,
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { DUPLICATE_SCAN_QUEUE_NAME } from "../lib/queueNames";
import { getElasticsearchClient } from "../services/elasticsearchService";
import valkeyConnection from "../lib/valkey";
import { DuplicateAnalysisService, MAX_PAIRS_PER_SCAN } from "../lib/llm/services/duplicate-detection/duplicate-analysis.service";
import { LlmManager } from "../lib/llm/services/llm-manager.service";
import { PromptResolver } from "../lib/llm/services/prompt-resolver.service";

// ─── Job data / result types ────────────────────────────────────────────────

export interface DuplicateScanJobData extends MultiTenantJobData {
  projectId: number;
  userId: string;
}

export interface DuplicateScanJobResult {
  pairsFound: number;
  casesScanned: number;
  scanJobId: string;
}

// ─── Redis cancellation key helper ──────────────────────────────────────────

function cancelKey(jobId: string | undefined): string {
  return `duplicate-scan:cancel:${jobId}`;
}

// ─── Processor ──────────────────────────────────────────────────────────────

export const processor = async (
  job: Job<DuplicateScanJobData>
): Promise<DuplicateScanJobResult> => {
  console.log(
    `Processing duplicate scan job ${job.id} for project ${job.data.projectId}` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );

  // 1. Validate multi-tenant context
  validateMultiTenantJobData(job.data);

  // 2. Get tenant-specific Prisma client
  const prisma = getPrismaClientForJob(job.data);

  // 3. Create DuplicateScanService instance
  const esClient = getElasticsearchClient();
  const service = new DuplicateScanService(prisma as any, esClient);

  // 4. Check for pre-start cancellation
  const redis = await worker!.client;
  const cancelled = await redis.get(cancelKey(job.id));
  if (cancelled) {
    await redis.del(cancelKey(job.id));
    throw new Error("Job cancelled by user");
  }

  // 5. Fetch all non-deleted cases for the project with steps and tags for richer matching
  const cases = await prisma.repositoryCases.findMany({
    where: { projectId: job.data.projectId, isDeleted: false },
    select: {
      id: true,
      name: true,
      steps: { select: { step: true, expectedResult: true }, orderBy: { order: "asc" } },
      tags: { select: { name: true } },
    },
  });

  // 5b. Load previously resolved pairs (dismissed, linked, merged) so they are excluded from results
  const resolvedRows = await prisma.duplicateScanResult.findMany({
    where: {
      projectId: job.data.projectId,
      status: { in: ["DISMISSED", "LINKED", "MERGED"] },
    },
    select: { caseAId: true, caseBId: true },
  });
  const resolvedPairs = new Set<string>(
    resolvedRows.map((r: { caseAId: number; caseBId: number }) => {
      // Normalize to canonical ordering (smaller ID first) to match scan pair keys
      const a = Math.min(r.caseAId, r.caseBId);
      const b = Math.max(r.caseAId, r.caseBId);
      return `${a}:${b}`;
    })
  );

  const total = cases.length;
  const seenPairs = new Set<string>();
  const allPairs: Array<{
    caseAId: number;
    caseBId: number;
    score: number;
    confidence: string;
    matchedFields: string[];
  }> = [];

  // 6. Process cases in batches for parallel ES queries
  const BATCH_SIZE = 20;
  let analyzed = 0;

  for (let batchStart = 0; batchStart < cases.length; batchStart += BATCH_SIZE) {
    // Check cancellation once per batch
    const isCancelled = await redis.get(cancelKey(job.id));
    if (isCancelled) {
      await redis.del(cancelKey(job.id));
      throw new Error("Job cancelled by user");
    }

    const batch = cases.slice(batchStart, batchStart + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map((testCase) =>
        service.findSimilarCases(
          {
            id: testCase.id,
            name: testCase.name,
            steps: testCase.steps as { step: string; expectedResult: string }[],
            tags: testCase.tags as { name: string }[],
          },
          job.data.projectId,
          job.data.tenantId
        )
      )
    );

    for (const pairs of batchResults) {
      for (const pair of pairs) {
        const key = `${pair.caseAId}:${pair.caseBId}`;
        if (!seenPairs.has(key) && !resolvedPairs.has(key)) {
          seenPairs.add(key);
          allPairs.push(pair);
        }
      }
    }

    analyzed += batch.length;
    await job.updateProgress({ analyzed, total });
  }

  // 7. Sort by score descending
  allPairs.sort((a, b) => b.score - a.score);

  // 7b. Optional LLM semantic pass — top MAX_PAIRS_PER_SCAN pairs only
  //     Gracefully skipped if no LLM integration is configured.
  await job.updateProgress({ analyzed: total, total, phase: "ai" });
  let finalPairs: Array<typeof allPairs[0] & { detectionMethod: string }>;
  try {
    const llmManager = LlmManager.createForWorker(prisma as any, job.data.tenantId);
    const promptResolver = new PromptResolver(prisma as any);
    const semanticService = new DuplicateAnalysisService(llmManager, promptResolver);

    // Build case lookup for name+steps enrichment
    const caseMap = new Map(cases.map((c) => [c.id, c]));

    const topPairs = allPairs.slice(0, MAX_PAIRS_PER_SCAN).map((p) => {
      const caseA = caseMap.get(p.caseAId);
      const caseB = caseMap.get(p.caseBId);
      const formatSteps = (steps: { step: unknown; expectedResult: unknown }[]) =>
        steps.map((s, i) => `Step ${i + 1}: ${s.step}\nExpected: ${s.expectedResult}`).join("\n");
      return {
        ...p,
        caseAName: caseA?.name ?? "",
        caseASteps: formatSteps((caseA?.steps ?? []) as any),
        caseBName: caseB?.name ?? "",
        caseBSteps: formatSteps((caseB?.steps ?? []) as any),
      };
    });

    const analyzedTop = await semanticService.analyzePairs(topPairs as any, job.data.projectId, job.data.userId);
    const overflow = allPairs.slice(MAX_PAIRS_PER_SCAN).map((p) => ({ ...p, detectionMethod: "fuzzy" }));
    finalPairs = [...analyzedTop, ...overflow];
  } catch (err) {
    // LLM pass failed entirely — log and fall back to fuzzy-only
    console.warn("[duplicate-scan] LLM semantic pass failed, using fuzzy-only results:", (err as Error).message);
    finalPairs = allPairs.map((p) => ({ ...p, detectionMethod: "fuzzy" }));
  }

  // 8. Soft-delete old pending results, then insert new ones atomically
  //    Use a longer timeout for large result sets
  await prisma.$transaction(async (tx: any) => {
    await tx.duplicateScanResult.updateMany({
      where: { projectId: job.data.projectId, status: "PENDING", isDeleted: false },
      data: { isDeleted: true },
    });

    if (finalPairs.length > 0) {
      // Batch createMany in chunks of 500 to avoid query size limits
      const CHUNK_SIZE = 500;
      for (let i = 0; i < finalPairs.length; i += CHUNK_SIZE) {
        const chunk = finalPairs.slice(i, i + CHUNK_SIZE);
        await tx.duplicateScanResult.createMany({
          data: chunk.map((p) => ({
            projectId: job.data.projectId,
            caseAId: p.caseAId,
            caseBId: p.caseBId,
            score: p.score,
            matchedFields: p.matchedFields,
            detectionMethod: p.detectionMethod,
            scanJobId: job.id,
          })),
          skipDuplicates: true,
        });
      }
    }
  }, { timeout: 30000 });

  return {
    pairsFound: finalPairs.length,
    casesScanned: total,
    scanJobId: job.id!,
  };
};

// ─── Worker setup ───────────────────────────────────────────────────────────

let worker: Worker<DuplicateScanJobData, DuplicateScanJobResult> | null = null;

export function startDuplicateScanWorker() {
  if (isMultiTenantMode()) {
    console.log("Duplicate scan worker starting in MULTI-TENANT mode");
  } else {
    console.log("Duplicate scan worker starting in SINGLE-TENANT mode");
  }

  worker = new Worker<DuplicateScanJobData, DuplicateScanJobResult>(
    DUPLICATE_SCAN_QUEUE_NAME,
    processor,
    { connection: valkeyConnection as any, concurrency: 1 }
  );

  worker.on("completed", (job) =>
    console.log(`Duplicate scan job ${job.id} completed`)
  );
  worker.on("failed", (job, err) =>
    console.error(`Duplicate scan job ${job?.id} failed:`, err.message)
  );
  worker.on("error", (err) => {
    console.error("Duplicate scan worker error:", err);
  });

  console.log(
    `Duplicate scan worker started for queue "${DUPLICATE_SCAN_QUEUE_NAME}".`
  );

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down duplicate scan worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down duplicate scan worker...");
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
  console.log("Duplicate scan worker running...");
  startDuplicateScanWorker();
}

export default worker;
