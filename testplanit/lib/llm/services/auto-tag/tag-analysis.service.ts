/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from "@prisma/client";

import { LLM_FEATURES } from "~/lib/llm/constants";
import type { LlmManager } from "~/lib/llm/services/llm-manager.service";
import type { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";

import { extractEntityContent } from "./content-extractor";
import { matchTagSuggestions } from "./tag-matcher";
import type {
  AutoTagAIResponse,
  BatchConfig,
  EntityContent,
  EntityType,
  TagAnalysisResult,
  TagSuggestion,
} from "./types";

const DEFAULT_CONTENT_BUDGET_RATIO = 0.65;

interface AnalyzeTagsParams {
  entityIds: number[];
  entityType: EntityType;
  projectId: number;
  userId: string;
  onBatchComplete?: (processed: number, total: number) => Promise<void>;
}

/**
 * Create batches of entities that fit within the token budget.
 *
 * - Entities that fit are grouped into batches respecting the budget.
 * - Oversized entities (exceeding budget alone) are truncated and placed in their own batch.
 */
export function createBatches(
  entities: EntityContent[],
  config: BatchConfig,
): EntityContent[][] {
  if (entities.length === 0) return [];

  const contentBudget = Math.floor(
    config.maxTokensPerRequest * config.contentBudgetRatio -
      config.systemPromptTokens,
  );

  const batches: EntityContent[][] = [];
  let currentBatch: EntityContent[] = [];
  let currentTokens = 0;

  for (const entity of entities) {
    // Oversized entity: truncate and give it its own batch
    if (entity.estimatedTokens > contentBudget) {
      // Flush current batch if non-empty
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }

      // Truncate: slice textContent to fit budget (chars ~= tokens * 4)
      const maxChars = contentBudget * 4;
      const truncated: EntityContent = {
        ...entity,
        textContent: entity.textContent.slice(0, maxChars),
        estimatedTokens: Math.ceil(
          Math.min(entity.textContent.length, maxChars) / 4,
        ),
      };
      batches.push([truncated]);
      continue;
    }

    // Check if adding this entity would exceed input budget or entity count limit
    const maxPerBatch = config.maxEntitiesPerBatch ?? Infinity;
    if (currentTokens + entity.estimatedTokens > contentBudget || currentBatch.length >= maxPerBatch) {
      // Start new batch
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      currentBatch = [entity];
      currentTokens = entity.estimatedTokens;
    } else {
      currentBatch.push(entity);
      currentTokens += entity.estimatedTokens;
    }
  }

  // Flush remaining
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
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
    private promptResolver: PromptResolver,
  ) {}

  async analyzeTags(params: AnalyzeTagsParams): Promise<TagAnalysisResult> {
    const { entityIds, entityType, projectId, userId } = params;

    // 1. Get project-level LLM integration (falls back to system default)
    const integrationId = await this.llmManager.getProjectIntegration(projectId);
    if (!integrationId) {
      throw new Error(
        "No LLM integration configured. Please set up an LLM provider in admin settings or assign one to this project.",
      );
    }

    // 2. Fetch LlmProviderConfig for token limits
    const providerConfig = await this.prisma.llmProviderConfig.findFirst({
      where: { llmIntegrationId: integrationId },
    });
    const maxTokensPerRequest = providerConfig?.maxTokensPerRequest ?? 4096;

    console.log(
      `[auto-tag] Using integration ${integrationId}, model: ${providerConfig?.defaultModel}, maxTokensPerRequest: ${maxTokensPerRequest}`,
    );

    // 3. Fetch all existing (non-deleted) tags
    const existingTags = await (this.prisma as any).tags.findMany({
      where: { isDeleted: false },
    });
    const existingTagNames: string[] = existingTags.map(
      (t: any) => t.name as string,
    );

    // 4. Resolve prompt via 3-tier chain
    const resolvedPrompt = await this.promptResolver.resolve(
      LLM_FEATURES.AUTO_TAG,
      projectId,
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
      }),
    );

    // 7. Estimate system prompt tokens for batch config
    const existingTagsString = existingTagNames.join(", ");
    const systemPromptTokens =
      Math.ceil(resolvedPrompt.systemPrompt.length / 4) +
      Math.ceil(existingTagsString.length / 4);

    // Each entity's output is ~40 tokens: {"entityId":NNN,"tags":["tag1","tag2","tag3"]}
    const OUTPUT_TOKENS_PER_ENTITY = 40;
    const maxEntitiesPerBatch = Math.max(1, Math.floor(resolvedPrompt.maxOutputTokens / OUTPUT_TOKENS_PER_ENTITY));

    const batchConfig: BatchConfig = {
      maxTokensPerRequest,
      contentBudgetRatio: DEFAULT_CONTENT_BUDGET_RATIO,
      systemPromptTokens,
      maxEntitiesPerBatch,
    };

    // 8. Create batches
    const batches = createBatches(entityContents, batchConfig);


    // 9. Process batches sequentially
    let allSuggestions: TagSuggestion[] = [];
    let totalTokensUsed = 0;
    let processedEntities = 0;
    let failedBatchCount = 0;
    const errors: string[] = [];

    for (const batch of batches) {
      try {
        const userPrompt = this.buildUserPrompt(batch, existingTagNames);

        const response = await this.llmManager.chat(integrationId, {
          messages: [
            { role: "system", content: resolvedPrompt.systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: resolvedPrompt.temperature,
          maxTokens: resolvedPrompt.maxOutputTokens,
          userId,
          projectId,
          feature: LLM_FEATURES.AUTO_TAG,
          disableThinking: true, // JSON output — no reasoning needed
        });

        totalTokensUsed += response.totalTokens;

        // Parse LLM response
        const parsed = this.parseLlmResponse(response.content);
        if (!parsed) continue;

        // Process each entity's suggestions
        for (const entitySugg of parsed.suggestions) {
          const entityContent = batch.find(
            (e) => e.id === entitySugg.entityId,
          );
          if (!entityContent) continue;

          const matched = matchTagSuggestions(
            entitySugg.tags,
            existingTagNames,
            entityContent.existingTagNames,
          );

          for (const match of matched) {
            allSuggestions.push({
              entityId: entitySugg.entityId,
              entityType,
              tagName: match.tagName,
              isExisting: match.isExisting,
              matchedExistingTag: match.matchedExistingTag,
            });
          }
        }
      } catch (error) {
        failedBatchCount++;
        const msg = error instanceof Error ? error.message : String(error);
        // Keep unique errors only (same error repeats for every batch)
        if (!errors.includes(msg)) {
          errors.push(msg);
        }
        console.warn(
          `Auto-tag batch failed (${batch.length} entities):`,
          msg,
        );
      }

      // Report progress after each batch (even on failure — per-batch error isolation)
      processedEntities += batch.length;
      if (params.onBatchComplete) {
        await params.onBatchComplete(processedEntities, entityContents.length);
      }
    }

    return {
      suggestions: allSuggestions,
      totalTokensUsed,
      batchCount: batches.length,
      entityCount: entityContents.length,
      failedBatchCount,
      errors,
    };
  }

  /**
   * Fetch entities from the database based on type.
   * Keeps includes shallow (max 2 levels) to avoid ZenStack alias length issues.
   */
  private async fetchEntities(
    entityIds: number[],
    entityType: EntityType,
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
  private async buildFolderPath(
    folder: any,
  ): Promise<string> {
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
  ): string {
    const parts: string[] = [];

    parts.push("EXISTING PROJECT TAGS:");
    parts.push(
      existingTagNames.length > 0
        ? existingTagNames.join(", ")
        : "(none)",
    );
    parts.push("");
    parts.push("ENTITIES TO ANALYZE:");

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]!;
      parts.push("");
      parts.push(
        `--- Entity ${i + 1} (ID: ${entity.id}, Type: ${entity.entityType}) ---`,
      );
      parts.push(`Name: ${entity.name}`);
      if (entity.existingTagNames.length > 0) {
        parts.push(
          `Already tagged: [${entity.existingTagNames.join(", ")}]`,
        );
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
   */
  private parseLlmResponse(content: string): AutoTagAIResponse | null {
    try {
      let jsonStr = content.trim();

      // Strip markdown code fences if present
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "");
        jsonStr = jsonStr.replace(/\n?```\s*$/, "");
        jsonStr = jsonStr.trim();
      }

      // Strip truncation marker appended by Gemini adapter
      jsonStr = jsonStr.replace(/\n?\n?\[Response was truncated due to length limit\]\s*$/, "");

      // Sanitize control characters that break JSON.parse (tabs/newlines inside strings)
      // eslint-disable-next-line no-control-regex
      jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

      let parsed: AutoTagAIResponse;
      try {
        parsed = JSON.parse(jsonStr) as AutoTagAIResponse;
      } catch (parseErr) {
        // Attempt to salvage truncated JSON by closing open arrays/objects
        console.warn("[auto-tag] Initial parse failed, attempting truncated JSON recovery");
        const salvaged = this.salvageTruncatedJson(jsonStr);
        if (!salvaged) {
          console.warn(
            "[auto-tag] Failed to parse LLM response:",
            parseErr instanceof Error ? parseErr.message : parseErr,
          );
          return null;
        }
        parsed = salvaged;
      }

      if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
        console.warn("[auto-tag] Response missing suggestions array");
        return null;
      }

      return parsed;
    } catch (error) {
      console.warn(
        "[auto-tag] Failed to parse LLM response:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}
