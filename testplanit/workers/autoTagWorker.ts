import { Worker, Job } from "bullmq";
import { pathToFileURL } from "node:url";
import valkeyConnection from "../lib/valkey";
import { AUTO_TAG_QUEUE_NAME } from "../lib/queueNames";
import {
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  disconnectAllTenantClients,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { LlmManager } from "../lib/llm/services/llm-manager.service";
import { PromptResolver } from "../lib/llm/services/prompt-resolver.service";
import { TagAnalysisService } from "../lib/llm/services/auto-tag/tag-analysis.service";
import type { EntityType, TagSuggestion } from "../lib/llm/services/auto-tag/types";

// ─── Job data / result types ────────────────────────────────────────────────

export interface AutoTagJobData extends MultiTenantJobData {
  entityIds: number[];
  entityType: EntityType;
  projectId: number;
  userId: string;
}

export interface AutoTagJobResult {
  suggestions: Array<{
    entityId: number;
    entityType: EntityType;
    entityName: string;
    currentTags: string[];
    tags: Array<{
      tagName: string;
      isExisting: boolean;
      matchedExistingTag?: string;
    }>;
  }>;
  stats: {
    entityCount: number;
    totalSuggestions: number;
    existingTagCount: number;
    newTagCount: number;
    totalTokensUsed: number;
    batchCount: number;
    failedBatchCount: number;
  };
  errors: string[];
}

// ─── Redis cancellation key helper ──────────────────────────────────────────

function cancelKey(jobId: string | undefined): string {
  return `auto-tag:cancel:${jobId}`;
}

// ─── Processor ──────────────────────────────────────────────────────────────

const processor = async (job: Job<AutoTagJobData>): Promise<AutoTagJobResult> => {
  console.log(
    `Processing auto-tag job ${job.id} for ${job.data.entityIds.length} entities` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : ""),
  );

  // 1. Validate multi-tenant context
  validateMultiTenantJobData(job.data);

  // 2. Get tenant-specific Prisma client
  const prisma = getPrismaClientForJob(job.data);

  // 3. Create per-tenant service instances (bypass singleton for worker isolation)
  const llmManager = LlmManager.createForWorker(prisma);
  const promptResolver = new PromptResolver(prisma);
  const service = new TagAnalysisService(prisma, llmManager, promptResolver);

  // 4. Check for pre-start cancellation
  const redis = await worker!.client;
  const cancelled = await redis.get(cancelKey(job.id));
  if (cancelled) {
    await redis.del(cancelKey(job.id));
    throw new Error("Job cancelled by user");
  }

  // 5. Run analysis with progress reporting and cancellation checks
  const result = await service.analyzeTags({
    entityIds: job.data.entityIds,
    entityType: job.data.entityType,
    projectId: job.data.projectId,
    userId: job.data.userId,
    onBatchComplete: async (processed: number, total: number) => {
      // Report progress to BullMQ
      await job.updateProgress({ analyzed: processed, total });

      // Check for cancellation between batches
      const isCancelled = await redis.get(cancelKey(job.id));
      if (isCancelled) {
        await redis.del(cancelKey(job.id));
        throw new Error("Job cancelled by user");
      }
    },
  });

  // 6. Signal "finalizing" so the UI knows analysis is done but results are being prepared
  await job.updateProgress({ analyzed: job.data.entityIds.length, total: job.data.entityIds.length, finalizing: true });

  // 7. Transform flat suggestions into grouped AutoTagJobResult format
  const entityMap = new Map<
    number,
    Array<{ tagName: string; isExisting: boolean; matchedExistingTag?: string }>
  >();

  for (const s of result.suggestions) {
    if (!entityMap.has(s.entityId)) {
      entityMap.set(s.entityId, []);
    }
    entityMap.get(s.entityId)!.push({
      tagName: s.tagName,
      isExisting: s.isExisting,
      matchedExistingTag: s.matchedExistingTag,
    });
  }

  // 7. Fetch entity names and current tags only for entities with suggestions
  const entityMeta = new Map<number, { name: string; currentTags: string[] }>();
  const entityIds = Array.from(entityMap.keys());

  switch (job.data.entityType) {
    case "repositoryCase": {
      const entities = await prisma.repositoryCases.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, name: true, tags: { select: { name: true } } },
      });
      for (const e of entities) {
        entityMeta.set(e.id, { name: e.name, currentTags: e.tags.map((t) => t.name) });
      }
      break;
    }
    case "testRun": {
      const entities = await prisma.testRuns.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, name: true, tags: { select: { name: true } } },
      });
      for (const e of entities) {
        entityMeta.set(e.id, { name: e.name, currentTags: e.tags.map((t) => t.name) });
      }
      break;
    }
    case "session": {
      const entities = await prisma.sessions.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, name: true, tags: { select: { name: true } } },
      });
      for (const e of entities) {
        entityMeta.set(e.id, { name: e.name, currentTags: e.tags.map((t) => t.name) });
      }
      break;
    }
  }

  const suggestions = Array.from(entityMap.entries()).map(([entityId, tags]) => ({
    entityId,
    entityType: job.data.entityType,
    entityName: entityMeta.get(entityId)?.name ?? `Entity ${entityId}`,
    currentTags: entityMeta.get(entityId)?.currentTags ?? [],
    tags,
  }));

  const existingTagCount = result.suggestions.filter((s) => s.isExisting).length;

  return {
    suggestions,
    stats: {
      entityCount: result.entityCount,
      totalSuggestions: result.suggestions.length,
      existingTagCount,
      newTagCount: result.suggestions.length - existingTagCount,
      totalTokensUsed: result.totalTokensUsed,
      batchCount: result.batchCount,
      failedBatchCount: result.failedBatchCount,
    },
    errors: result.errors,
  };
};

// ─── Worker setup ───────────────────────────────────────────────────────────

let worker: Worker<AutoTagJobData, AutoTagJobResult> | null = null;

const startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("Auto-tag worker starting in MULTI-TENANT mode");
  } else {
    console.log("Auto-tag worker starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    worker = new Worker<AutoTagJobData, AutoTagJobResult>(
      AUTO_TAG_QUEUE_NAME,
      processor,
      {
        connection: valkeyConnection as any,
        concurrency: 3, // Process up to 3 jobs in parallel (one per entity type)
      },
    );

    worker.on("completed", (job) => {
      console.log(`Auto-tag job ${job.id} completed successfully.`);
    });

    worker.on("failed", (job, err) => {
      console.error(`Auto-tag job ${job?.id} failed:`, err.message);
    });

    worker.on("error", (err) => {
      console.error("Auto-tag worker error:", err);
    });

    console.log(`Auto-tag worker started for queue "${AUTO_TAG_QUEUE_NAME}".`);
  } else {
    console.warn("Valkey connection not available. Auto-tag worker not started.");
  }

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down auto-tag worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down auto-tag worker...");
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
    (import.meta as any).url === undefined)
) {
  console.log("Auto-tag worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start auto-tag worker:", err);
    process.exit(1);
  });
}

export default worker;
