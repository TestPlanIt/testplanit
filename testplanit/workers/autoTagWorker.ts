import { Job, Worker } from "bullmq";
import { pathToFileURL } from "node:url";
import { TagAnalysisService } from "../lib/llm/services/auto-tag/tag-analysis.service";
import type {
  EntityType
} from "../lib/llm/services/auto-tag/types";
import { LlmManager } from "../lib/llm/services/llm-manager.service";
import { PromptResolver } from "../lib/llm/services/prompt-resolver.service";
import {
  disconnectAllTenantClients, getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData, validateMultiTenantJobData
} from "../lib/multiTenantPrisma";
import { AUTO_TAG_QUEUE_NAME } from "../lib/queueNames";
import valkeyConnection from "../lib/valkey";

// ─── Job data / result types ────────────────────────────────────────────────

export interface AutoTagJobData extends MultiTenantJobData {
  entityIds: number[];
  entityType: EntityType;
  projectId: number;
  userId: string;
  allowNewTags?: boolean;
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
    failed?: boolean;
    truncated?: boolean;
    errorMessage?: string;
    automated?: boolean;
    source?: string;
    testRunType?: string;
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

const processor = async (
  job: Job<AutoTagJobData>
): Promise<AutoTagJobResult> => {
  console.log(
    `Processing auto-tag job ${job.id} for ${job.data.entityIds.length} entities` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );

  // 1. Validate multi-tenant context
  validateMultiTenantJobData(job.data);

  // 2. Get tenant-specific Prisma client
  const prisma = getPrismaClientForJob(job.data);

  // 3. Create per-tenant service instances (bypass singleton for worker isolation)
  const llmManager = LlmManager.createForWorker(prisma, job.data.tenantId);
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
      await job.updateProgress({ analyzed: processed, total });
    },
    allowNewTags: job.data.allowNewTags ?? true,
    isCancelled: async () => {
      const flag = await redis.get(cancelKey(job.id));
      if (flag) {
        await redis.del(cancelKey(job.id));
        return true;
      }
      return false;
    },
  });

  // 6. If cancelled between batches, throw so the job is marked as failed
  if (result.cancelled) {
    throw new Error("Job cancelled by user");
  }

  // 8. Signal "finalizing" so the UI knows analysis is done but results are being prepared
  await job.updateProgress({
    analyzed: job.data.entityIds.length,
    total: job.data.entityIds.length,
    finalizing: true,
  });

  // 9. Transform flat suggestions into grouped AutoTagJobResult format
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

  // Collect all entity IDs we need metadata for (all submitted entities)
  const failedEntityIdSet = new Set(result.failedEntityIds);
  const allRelevantIds = [...job.data.entityIds];

  // 10. Fetch entity names, current tags, and display metadata for all relevant entities
  const entityMeta = new Map<
    number,
    {
      name: string;
      currentTags: string[];
      automated?: boolean;
      source?: string;
      testRunType?: string;
    }
  >();

  if (allRelevantIds.length > 0) {
    switch (job.data.entityType) {
      case "repositoryCase": {
        const entities = await prisma.repositoryCases.findMany({
          where: { id: { in: allRelevantIds } },
          select: {
            id: true,
            name: true,
            automated: true,
            source: true,
            tags: { select: { name: true } },
          },
        });
        for (const e of entities) {
          entityMeta.set(e.id, {
            name: e.name,
            currentTags: e.tags.map((t) => t.name),
            automated: e.automated,
            source: e.source,
          });
        }
        break;
      }
      case "testRun": {
        const entities = await prisma.testRuns.findMany({
          where: { id: { in: allRelevantIds } },
          select: {
            id: true,
            name: true,
            testRunType: true,
            tags: { select: { name: true } },
          },
        });
        for (const e of entities) {
          entityMeta.set(e.id, {
            name: e.name,
            currentTags: e.tags.map((t) => t.name),
            testRunType: e.testRunType,
          });
        }
        break;
      }
      case "session": {
        const entities = await prisma.sessions.findMany({
          where: { id: { in: allRelevantIds } },
          select: { id: true, name: true, tags: { select: { name: true } } },
        });
        for (const e of entities) {
          entityMeta.set(e.id, {
            name: e.name,
            currentTags: e.tags.map((t) => t.name),
          });
        }
        break;
      }
    }
  }

  // Build suggestions for successful entities
  const suggestions: AutoTagJobResult["suggestions"] = Array.from(
    entityMap.entries()
  ).map(([entityId, tags]) => {
    const meta = entityMeta.get(entityId);
    return {
      entityId,
      entityType: job.data.entityType,
      entityName: meta?.name ?? `Unknown`,
      currentTags: meta?.currentTags ?? [],
      tags,
      automated: meta?.automated,
      source: meta?.source,
      testRunType: meta?.testRunType,
    };
  });

  // Append failed entities with empty tags and error flag
  const errorMessage =
    result.errors.length > 0
      ? result.errors[result.errors.length - 1]
      : "Analysis failed";
  for (const failedId of failedEntityIdSet) {
    if (!entityMap.has(failedId)) {
      const meta = entityMeta.get(failedId);
      suggestions.push({
        entityId: failedId,
        entityType: job.data.entityType,
        entityName: meta?.name ?? `Unknown`,
        currentTags: meta?.currentTags ?? [],
        tags: [],
        failed: true,
        errorMessage,
        automated: meta?.automated,
        source: meta?.source,
        testRunType: meta?.testRunType,
      });
    }
  }

  // Append truncated entities (suggestions lost due to LLM output truncation)
  const truncatedEntityIdSet = new Set(result.truncatedEntityIds);
  for (const truncatedId of truncatedEntityIdSet) {
    if (!entityMap.has(truncatedId) && !failedEntityIdSet.has(truncatedId)) {
      const meta = entityMeta.get(truncatedId);
      suggestions.push({
        entityId: truncatedId,
        entityType: job.data.entityType,
        entityName: meta?.name ?? `Unknown`,
        currentTags: meta?.currentTags ?? [],
        tags: [],
        truncated: true,
        errorMessage:
          "LLM response was truncated — increase Max Output Tokens in LLM settings",
        automated: meta?.automated,
        source: meta?.source,
        testRunType: meta?.testRunType,
      });
    }
  }

  // Append entities with no suggestions (successfully analyzed but LLM returned no tags)
  for (const entityId of job.data.entityIds) {
    if (
      !entityMap.has(entityId) &&
      !failedEntityIdSet.has(entityId) &&
      !truncatedEntityIdSet.has(entityId)
    ) {
      const meta = entityMeta.get(entityId);
      if (meta) {
        suggestions.push({
          entityId,
          entityType: job.data.entityType,
          entityName: meta.name,
          currentTags: meta.currentTags,
          tags: [],
          automated: meta.automated,
          source: meta.source,
          testRunType: meta.testRunType,
        });
      }
    }
  }

  const existingTagCount = result.suggestions.filter(
    (s) => s.isExisting
  ).length;

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
        concurrency: parseInt(process.env.AUTO_TAG_CONCURRENCY || "3", 10), // Process up to 3 jobs in parallel (one per entity type)
      }
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
    console.warn(
      "Valkey connection not available. Auto-tag worker not started."
    );
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
  typeof import.meta === "undefined" ||
  (import.meta as any).url === undefined
) {
  console.log("Auto-tag worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start auto-tag worker:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
