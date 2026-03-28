import type { PrismaClient } from "@prisma/client";

import { LLM_FEATURES } from "~/lib/llm/constants";
import {
  createBatches,
  executeBatches,
} from "~/lib/llm/services/batch-processor";
import type { LlmManager } from "~/lib/llm/services/llm-manager.service";
import type { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";

import { extractEntityContent } from "./content-extractor";
import { matchTagSuggestions } from "./tag-matcher";
import type {
  AutoTagAIResponse,
  EntityContent,
  EntityType,
  TagAnalysisResult,
  TagSuggestion,
} from "./types";

interface AnalyzeTagsParams {
  entityIds: number[];
  entityType: EntityType;
  projectId: number;
  userId: string;
  allowNewTags?: boolean;
  onBatchComplete?: (processed: number, total: number) => Promise<void>;
  isCancelled?: () => Promise<boolean>;
}

/**
 * Core tag analysis orchestration service.
 *
 * Given entity IDs and type, fetches their content, batches within token limits,
 * calls the LLM for tag suggestions, and fuzzy-matches results against existing
 * project tags.
 */
export class TagAnalysisService {
  constructor(
    private prisma: PrismaClient,
    private llmManager: LlmManager,
    private promptResolver: PromptResolver
  ) {}

  async analyzeTags(params: AnalyzeTagsParams): Promise<TagAnalysisResult> {
    const {
      entityIds,
      entityType,
      projectId,
      userId,
      allowNewTags = true,
    } = params;

    // 1. Resolve prompt via 3-tier chain (needed before resolveIntegration)
    const resolvedPrompt = await this.promptResolver.resolve(
      LLM_FEATURES.AUTO_TAG,
      projectId
    );

    // 2. Get LLM integration via 3-tier resolution chain
    const resolved = await this.llmManager.resolveIntegration(
      LLM_FEATURES.AUTO_TAG,
      projectId,
      resolvedPrompt
    );
    if (!resolved) {
      throw new Error(
        "No LLM integration configured. Please set up an LLM provider in admin settings or assign one to this project."
      );
    }
    const integrationId = resolved.integrationId;

    // 3. Fetch LlmProviderConfig for token limits
    const providerConfig = await this.prisma.llmProviderConfig.findFirst({
      where: { llmIntegrationId: integrationId },
    });
    const maxTokensPerRequest = providerConfig?.maxTokensPerRequest ?? 4096;

    console.log(
      `[auto-tag] Using integration ${integrationId}, model: ${resolved.model ?? providerConfig?.defaultModel}, maxTokensPerRequest: ${maxTokensPerRequest}`
    );

    // 4. Fetch all existing (non-deleted) tags
    const existingTags = await (this.prisma as any).tags.findMany({
      where: { isDeleted: false },
    });
    const existingTagNames: string[] = existingTags.map(
      (t: any) => t.name as string
    );

    // 5. Fetch entities
    const entities = await this.fetchEntities(entityIds, entityType);

    // 6. Convert to EntityContent
    const entityContents = await Promise.all(
      entities.map(async (entity: any) => {
        let folderPath: string | undefined;
        if (entityType === "repositoryCase" && entity.folder) {
          folderPath = await this.buildFolderPath(entity.folder);
        }
        return extractEntityContent(entity, entityType, folderPath);
      })
    );

    // 7. Estimate system prompt tokens for batch config
    const existingTagsString = existingTagNames.join(", ");
    const systemPromptTokens =
      Math.ceil(resolvedPrompt.systemPrompt.length / 4) +
      Math.ceil(existingTagsString.length / 4);

    // Each entity's output is ~40 tokens: {"entityId":NNN,"tags":["tag1","tag2","tag3"]}
    const OUTPUT_TOKENS_PER_ENTITY = 40;
    const maxEntitiesPerBatch = Math.max(
      1,
      Math.floor(resolvedPrompt.maxOutputTokens / OUTPUT_TOKENS_PER_ENTITY)
    );

    // 8. Create batches using shared batch processor
    const batches = createBatches(
      entityContents,
      {
        maxTokensPerRequest,
        systemPromptTokens,
        maxItemsPerBatch: maxEntitiesPerBatch,
      },
      // Truncate oversized entities
      (entity, maxChars) => ({
        ...entity,
        textContent: entity.textContent.slice(0, maxChars),
        estimatedTokens: Math.ceil(
          Math.min(entity.textContent.length, maxChars) / 4
        ),
      })
    );

    // 9. Process batches using shared executor (with per-batch error isolation)
    let totalTokensUsed = 0;
    const allSuggestions: TagSuggestion[] = [];
    const truncatedEntityIds: number[] = [];

    /**
     * Process a batch of entities, retrying with smaller sub-batches if the
     * LLM response is truncated or unparseable. On failure, the batch is split
     * in half and each half is retried recursively until individual entities
     * are reached. This handles models with limited output token windows
     * gracefully.
     *
     * `maxWorkingBatchSize` remembers the largest batch size that succeeded
     * so we don't re-discover it through timeouts for every subsequent batch.
     */
    let maxWorkingBatchSize = Infinity;

    const processWithRetry = async (
      batch: EntityContent[],
      depth: number = 0
    ): Promise<void> => {
      // If we already know a smaller batch size works, pre-split to avoid
      // re-discovering it through timeouts for every subsequent batch.
      if (batch.length > maxWorkingBatchSize) {
        const chunks: EntityContent[][] = [];
        for (let i = 0; i < batch.length; i += maxWorkingBatchSize) {
          chunks.push(batch.slice(i, i + maxWorkingBatchSize));
        }
        console.log(
          `[auto-tag] Pre-splitting batch of ${batch.length} into ${chunks.length} chunks of ≤${maxWorkingBatchSize} (known working size)`
        );
        for (const chunk of chunks) {
          await processWithRetry(chunk, depth);
        }
        return;
      }

      const userPrompt = this.buildUserPrompt(batch, existingTagNames, allowNewTags);

      let response;
      try {
        response = await this.llmManager.chat(integrationId, {
          messages: [
            { role: "system", content: resolvedPrompt.systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: resolvedPrompt.temperature,
          maxTokens: resolvedPrompt.maxOutputTokens,
          userId,
          projectId,
          feature: LLM_FEATURES.AUTO_TAG,
          disableThinking: false,
          ...(resolved.model ? { model: resolved.model } : {}),
        });
      } catch (error: any) {
        // If the LLM timed out, back off on batch size (same as truncated response)
        const isTimeout =
          error?.code === "TIMEOUT" ||
          error?.message?.includes("timeout") ||
          error?.message?.includes("Timeout");
        if (isTimeout && batch.length > 1) {
          const mid = Math.ceil(batch.length / 2);
          maxWorkingBatchSize = Math.min(maxWorkingBatchSize, mid);
          console.warn(
            `[auto-tag] Timeout for batch of ${batch.length}, retrying as 2 sub-batches of ${mid} (maxWorkingBatchSize now ${maxWorkingBatchSize})`
          );
          await processWithRetry(batch.slice(0, mid), depth + 1);
          await processWithRetry(batch.slice(mid), depth + 1);
          return;
        }
        // Not a timeout or single entity — let it propagate to batch error handler
        throw error;
      }

      totalTokensUsed += response.totalTokens;

      // Parse LLM response
      const parsed = this.parseLlmResponse(response.content);

      // If parse failed entirely, retry with smaller batches
      if (!parsed) {
        if (batch.length <= 1) {
          // Can't split further — record as failed
          console.warn(
            `[auto-tag] Parse failed for single entity ${batch[0]?.id}, skipping`
          );
          truncatedEntityIds.push(...batch.map((e) => e.id));
          return;
        }

        const mid = Math.ceil(batch.length / 2);
        console.warn(
          `[auto-tag] Parse failed for batch of ${batch.length}, retrying as 2 sub-batches of ${mid} and ${batch.length - mid} (depth ${depth + 1})`
        );
        await processWithRetry(batch.slice(0, mid), depth + 1);
        await processWithRetry(batch.slice(mid), depth + 1);
        return;
      }

      // Track entity IDs the LLM responded about
      const respondedEntityIds = new Set(
        parsed.suggestions.map((s) => s.entityId)
      );

      // Process each entity's suggestions
      for (const entitySugg of parsed.suggestions) {
        const entityContent = batch.find((e) => e.id === entitySugg.entityId);
        if (!entityContent) continue;

        const matched = matchTagSuggestions(
          entitySugg.tags,
          existingTagNames,
          entityContent.existingTagNames
        );

        const filteredMatches = allowNewTags
          ? matched
          : matched.filter((m) => m.isExisting);

        for (const match of filteredMatches) {
          allSuggestions.push({
            entityId: entitySugg.entityId,
            entityType,
            tagName:
              match.isExisting && match.matchedExistingTag
                ? match.matchedExistingTag
                : match.tagName,
            isExisting: match.isExisting,
            matchedExistingTag: match.matchedExistingTag,
          });
        }
      }

      // If the response was truncated, retry missing entities with smaller batches
      if (parsed.truncated) {
        const missingEntities = batch.filter(
          (e) => !respondedEntityIds.has(e.id)
        );

        if (missingEntities.length > 0) {
          console.warn(
            `[auto-tag] Truncated response: ${missingEntities.length} entities missing, retrying them in smaller batches (depth ${depth + 1})`
          );

          if (missingEntities.length === batch.length) {
            // All missing — split in half
            const mid = Math.ceil(missingEntities.length / 2);
            await processWithRetry(missingEntities.slice(0, mid), depth + 1);
            await processWithRetry(missingEntities.slice(mid), depth + 1);
          } else {
            // Only some missing — retry just those as one batch (will split further if needed)
            await processWithRetry(missingEntities, depth + 1);
          }
        }
      }
    };

    const batchResult = await executeBatches({
      batches,
      onBatchComplete: params.onBatchComplete,
      isCancelled: params.isCancelled,
      processBatch: async (batch) => {
        await processWithRetry(batch);
      },
    });

    return {
      suggestions: allSuggestions,
      totalTokensUsed,
      batchCount: batchResult.batchCount,
      entityCount: entityContents.length,
      failedBatchCount: batchResult.failedBatchCount,
      errors: batchResult.errors,
      failedEntityIds: batchResult.failedItemIds,
      truncatedEntityIds,
      cancelled: batchResult.cancelled,
    };
  }

  /**
   * Fetch entities from the database based on type.
   * Keeps includes shallow (max 2 levels) to avoid ZenStack alias length issues.
   */
  private async fetchEntities(
    entityIds: number[],
    entityType: EntityType
  ): Promise<any[]> {
    switch (entityType) {
      case "repositoryCase":
        return (this.prisma as any).repositoryCases.findMany({
          where: { id: { in: entityIds }, isDeleted: false },
          include: {
            steps: {
              where: { isDeleted: false },
              orderBy: { order: "asc" },
            },
            caseFieldValues: { include: { field: true } },
            tags: true,
            folder: true,
          },
        });

      case "testRun":
        return (this.prisma as any).testRuns.findMany({
          where: { id: { in: entityIds }, isDeleted: false },
          include: { tags: true },
        });

      case "session":
        return (this.prisma as any).sessions.findMany({
          where: { id: { in: entityIds }, isDeleted: false },
          include: {
            sessionFieldValues: { include: { field: true } },
            tags: true,
          },
        });

      default:
        return [];
    }
  }

  /**
   * Build folder path string by walking parent folders up to root.
   */
  private async buildFolderPath(folder: any): Promise<string> {
    const parts: string[] = [folder.name];
    let currentParentId = folder.parentId;

    // Walk up the folder tree (max 20 levels to prevent infinite loops)
    let depth = 0;
    while (currentParentId && depth < 20) {
      const parent = await (this.prisma as any).repositoryFolders.findUnique({
        where: { id: currentParentId },
      });
      if (!parent) break;
      parts.unshift(parent.name);
      currentParentId = parent.parentId;
      depth++;
    }

    return parts.join(" / ");
  }

  /**
   * Build the user prompt containing entity data for the LLM.
   */
  private buildUserPrompt(
    entities: EntityContent[],
    existingTagNames: string[],
    allowNewTags: boolean
  ): string {
    const parts: string[] = [];

    parts.push("TAG ASSIGNMENT MODE:");
    if (allowNewTags) {
      parts.push("You may suggest either existing tags or new tags.");
    } else {
      parts.push(
        "Suggest ONLY tags from the EXISTING PROJECT TAGS list. Do not invent new tags.",
      );
    }
    parts.push("");

    parts.push("EXISTING PROJECT TAGS:");
    parts.push(
      existingTagNames.length > 0 ? existingTagNames.join(", ") : "(none)"
    );
    parts.push("");
    parts.push("ENTITIES TO ANALYZE:");

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!;
      parts.push("");
      parts.push(
        `--- Entity ${i + 1} (ID: ${entity.id}, Type: ${entity.entityType}) ---`
      );
      parts.push(`Name: ${entity.name}`);
      if (entity.existingTagNames.length > 0) {
        parts.push(`Already tagged: [${entity.existingTagNames.join(", ")}]`);
      }
      parts.push("Content:");
      parts.push(entity.textContent);
    }

    return parts.join("\n");
  }

  /**
   * Attempt to recover a truncated JSON response by finding the last complete
   * entity in the suggestions array and closing the JSON structure.
   */
  private salvageTruncatedJson(jsonStr: string): AutoTagAIResponse | null {
    // Find the last complete suggestion object: '}' followed by ',' or ']'
    // Pattern: look for last complete {"entityId":N,"tags":[...]}
    const lastCompleteEntry = jsonStr.lastIndexOf("}");
    if (lastCompleteEntry === -1) return null;

    // Try progressively shorter substrings ending at each '}' from the end
    let pos = lastCompleteEntry;
    while (pos > 0) {
      const candidate = jsonStr.substring(0, pos + 1) + "]}";
      try {
        const parsed = JSON.parse(candidate) as AutoTagAIResponse;
        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
          return parsed;
        }
      } catch {
        // Try next '}' position
      }
      pos = jsonStr.lastIndexOf("}", pos - 1);
    }
    return null;
  }

  /**
   * Parse LLM response JSON. Returns null on parse failure (graceful degradation).
   * The `truncated` flag indicates the response was salvaged from truncated JSON.
   */
  private parseLlmResponse(
    content: string
  ): (AutoTagAIResponse & { truncated?: boolean }) | null {
    try {
      let jsonStr = content.trim();

      // Strip markdown code fences if present
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "");
        jsonStr = jsonStr.replace(/\n?```\s*$/, "");
        jsonStr = jsonStr.trim();
      }

      // Strip truncation marker appended by Gemini adapter
      jsonStr = jsonStr.replace(
        /\n?\n?\[Response was truncated due to length limit\]\s*$/,
        ""
      );

      // Sanitize control characters that break JSON.parse (tabs/newlines inside strings)
      jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

      let parsed: AutoTagAIResponse;
      let truncated = false;
      try {
        parsed = JSON.parse(jsonStr) as AutoTagAIResponse;
      } catch (parseErr) {
        // Attempt to salvage truncated JSON by closing open arrays/objects
        console.warn(
          "[auto-tag] Initial parse failed, attempting truncated JSON recovery"
        );
        const salvaged = this.salvageTruncatedJson(jsonStr);
        if (!salvaged) {
          console.warn(
            "[auto-tag] Failed to parse LLM response:",
            parseErr instanceof Error ? parseErr.message : parseErr
          );
          return null;
        }
        parsed = salvaged;
        truncated = true;
      }

      if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
        console.warn("[auto-tag] Response missing suggestions array");
        return null;
      }

      return { ...parsed, truncated };
    } catch (error) {
      console.warn(
        "[auto-tag] Failed to parse LLM response:",
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }
}
