import type { DbClient } from "~/lib/zenstack";

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
 * Ceiling on entities per LLM request, applied on top of the output-token
 * budget below. It exists only to stop an integration configured with a very
 * large `maxOutputTokens` from producing batches of several hundred, which
 * exceed the input content budget anyway and lose accuracy. At the output
 * budgets in normal use the token math below is the tighter of the two, so this
 * does not bind.
 */
const MAX_ENTITIES_PER_REQUEST = 150;

/**
 * Output tokens one entity's answer costs, e.g.
 * `{"entityId":123456,"tags":["regression","api","login"]}`. The prompt caps
 * answers at five short tags, and the repo's chars/4 estimate puts the widest
 * allowed answer near 28 tokens, so this carries headroom without shrinking
 * batches below what models answer in one pass.
 */
const OUTPUT_TOKENS_PER_ENTITY = 40;

/**
 * Cap on how many existing tag names are listed in the prompt. Tags are global,
 * not project-scoped, so on a large instance this list dominates the request and
 * squeezes out the entity content it is meant to contextualize. The full list is
 * still used for fuzzy-matching the response, so existing-tag detection is
 * unaffected by the cap.
 */
const MAX_TAGS_IN_PROMPT = 500;

/** Max ids per `IN (...)` when loading entities and their relations. */
const ENTITY_FETCH_CHUNK = 500;

/** Bisection retries per batch before the remaining entities are given up on. */
const MAX_SPLIT_DEPTH = 6;

/**
 * Core tag analysis orchestration service.
 *
 * Given entity IDs and type, fetches their content, batches within token limits,
 * calls the LLM for tag suggestions, and fuzzy-matches results against existing
 * project tags.
 */
export class TagAnalysisService {
  constructor(
    private db: DbClient,
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
    const providerConfig = await this.db.llmProviderConfig.findFirst({
      where: { llmIntegrationId: integrationId },
    });
    const maxTokensPerRequest = providerConfig?.maxTokensPerRequest ?? 4096;

    // Prompt configs carry an admin-entered maxOutputTokens accepted anywhere in
    // 1..1048576, independent of what the integration can actually serve. Cap it
    // at the provider ceiling so an over-large value can't throw
    // MAX_TOKENS_EXCEEDED, and so batch sizing is derived from a figure the
    // model can really produce.
    const maxOutputTokens = Math.min(
      resolvedPrompt.maxOutputTokens,
      maxTokensPerRequest
    );

    console.log(
      `[auto-tag] Using integration ${integrationId}, model: ${resolved.model ?? providerConfig?.defaultModel}, maxTokensPerRequest: ${maxTokensPerRequest}, maxOutputTokens: ${maxOutputTokens}`
    );

    // 4. Fetch all existing (non-deleted) tags
    const existingTags = await (this.db as any).tags.findMany({
      where: { isDeleted: false },
    });
    const existingTagNames: string[] = existingTags.map(
      (t: any) => t.name as string
    );

    // 5. Fetch entities
    const entities = await this.fetchEntities(entityIds, entityType);

    // 6. Convert to EntityContent. Folder paths are memoized across entities —
    // cases share ancestors, so walking the tree per case would issue thousands
    // of concurrent findUnique calls and exhaust the connection pool.
    const folderPathCache = new Map<number, string>();
    const entityContents: EntityContent[] = [];
    for (const entity of entities as any[]) {
      let folderPath: string | undefined;
      if (entityType === "repositoryCase" && entity.folder) {
        folderPath = await this.buildFolderPath(entity.folder, folderPathCache);
      }
      entityContents.push(extractEntityContent(entity, entityType, folderPath));
    }

    // 7. Estimate system prompt tokens for batch config
    const promptTagNames = existingTagNames.slice(0, MAX_TAGS_IN_PROMPT);
    const existingTagsString = promptTagNames.join(", ");
    const systemPromptTokens =
      Math.ceil(resolvedPrompt.systemPrompt.length / 4) +
      Math.ceil(existingTagsString.length / 4);

    const maxEntitiesPerBatch = Math.min(
      MAX_ENTITIES_PER_REQUEST,
      Math.max(1, Math.floor(maxOutputTokens / OUTPUT_TOKENS_PER_ENTITY))
    );

    console.log(
      `[auto-tag] Batching ${entityContents.length} entities at up to ${maxEntitiesPerBatch} per request`
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
      if (batch.length === 0) return;

      // Give up rather than recurse forever on entities the model never answers
      // for. Callers see these as truncated, same as an unsplittable failure.
      if (depth >= MAX_SPLIT_DEPTH) {
        console.warn(
          `[auto-tag] Split depth ${depth} reached with ${batch.length} entities still unanswered, giving up on them`
        );
        truncatedEntityIds.push(...batch.map((e) => e.id));
        return;
      }

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

      const userPrompt = this.buildUserPrompt(
        batch,
        promptTagNames,
        allowNewTags
      );

      let response;
      try {
        response = await this.llmManager.chat(integrationId, {
          messages: [
            { role: "system", content: resolvedPrompt.systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: resolvedPrompt.temperature,
          maxTokens: maxOutputTokens,
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
        maxWorkingBatchSize = Math.min(maxWorkingBatchSize, mid);
        console.warn(
          `[auto-tag] Parse failed for batch of ${batch.length}, retrying as 2 sub-batches of ${mid} and ${batch.length - mid} (maxWorkingBatchSize now ${maxWorkingBatchSize}, depth ${depth + 1})`
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
          // A single entity that still truncates cannot be split any further —
          // retrying it would reissue an identical request forever.
          if (batch.length <= 1) {
            console.warn(
              `[auto-tag] Truncated response for single entity ${batch[0]?.id}, skipping`
            );
            truncatedEntityIds.push(...missingEntities.map((e) => e.id));
            return;
          }

          console.warn(
            `[auto-tag] Truncated response: ${missingEntities.length} entities missing, retrying them in smaller batches (depth ${depth + 1})`
          );

          if (missingEntities.length === batch.length) {
            // All missing — split in half
            const mid = Math.ceil(missingEntities.length / 2);
            maxWorkingBatchSize = Math.min(maxWorkingBatchSize, mid);
            await processWithRetry(missingEntities.slice(0, mid), depth + 1);
            await processWithRetry(missingEntities.slice(mid), depth + 1);
          } else {
            // Only some missing — the model got through the rest before running
            // out of output budget, so that count is a known-working size.
            maxWorkingBatchSize = Math.min(
              maxWorkingBatchSize,
              batch.length - missingEntities.length
            );
            // Retry just the missing ones (pre-split will size them down)
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
    // Linked-issue fields surfaced to the auto-tag LLM as prompt context.
    // Scalars (priority, issueTypeName, externalKey, title, externalStatus)
    // are persisted on every Issue regardless of provider. `data` carries
    // the non-customfield tracker metadata (labels, components) written
    // by SyncService — extracted opportunistically by content-extractor.
    // Kept to a `select` (not nested includes) so the join stays single-
    // level and the ZenStack alias budget isn't squeezed.
    const linkedIssueSelect = {
      externalKey: true,
      title: true,
      priority: true,
      issueTypeName: true,
      externalStatus: true,
      data: true,
    } as const;

    // Large selections are fetched in id-chunks. A single `IN (...)` over
    // thousands of ids joined against steps, field values, tags and issues is
    // one very expensive query; chunking keeps each round trip bounded.
    const chunks: number[][] = [];
    for (let i = 0; i < entityIds.length; i += ENTITY_FETCH_CHUNK) {
      chunks.push(entityIds.slice(i, i + ENTITY_FETCH_CHUNK));
    }

    const results: any[] = [];

    for (const ids of chunks) {
      switch (entityType) {
        case "repositoryCase": {
          // RepositoryCases links tags/issues through join tables (caseTags ->
          // tag, caseIssues -> issue), unlike testRuns/sessions which relate to
          // them directly. Fetch the joins, then flatten to the uniform
          // `tags`/`issues` shape the content-extractor reads.
          const cases = await (this.db as any).repositoryCases.findMany({
            where: { id: { in: ids }, isDeleted: false },
            include: {
              steps: {
                where: { isDeleted: false },
                orderBy: { order: "asc" },
              },
              caseFieldValues: { include: { field: true } },
              caseTags: { select: { tag: { select: { name: true } } } },
              folder: true,
              caseIssues: {
                where: { issue: { isDeleted: false } },
                select: { issue: { select: linkedIssueSelect } },
              },
            },
          });
          for (const c of cases) {
            results.push({
              ...c,
              tags: (c.caseTags ?? []).map((ct: any) => ct.tag),
              issues: (c.caseIssues ?? []).map((ci: any) => ci.issue),
            });
          }
          break;
        }

        case "testRun": {
          const runs = await (this.db as any).testRuns.findMany({
            where: { id: { in: ids }, isDeleted: false },
            include: {
              tags: true,
              issues: {
                where: { isDeleted: false },
                select: linkedIssueSelect,
              },
            },
          });
          results.push(...runs);
          break;
        }

        case "session": {
          const sessions = await (this.db as any).sessions.findMany({
            where: { id: { in: ids }, isDeleted: false },
            include: {
              sessionFieldValues: { include: { field: true } },
              tags: true,
              issues: {
                where: { isDeleted: false },
                select: linkedIssueSelect,
              },
            },
          });
          results.push(...sessions);
          break;
        }

        default:
          return [];
      }
    }

    return results;
  }

  /**
   * Build folder path string by walking parent folders up to root.
   *
   * `cache` is keyed by folder id and shared across every entity in the job.
   * Cases cluster in a handful of folders, so without it the same ancestor
   * chain is re-queried once per case.
   */
  private async buildFolderPath(
    folder: any,
    cache: Map<number, string>
  ): Promise<string> {
    const cached = cache.get(folder.id);
    if (cached !== undefined) return cached;

    const parts: string[] = [folder.name];
    let currentParentId = folder.parentId;

    // Walk up the folder tree (max 20 levels to prevent infinite loops)
    let depth = 0;
    while (currentParentId && depth < 20) {
      // A cached entry is already the full root-to-parent path, so it replaces
      // the rest of the walk.
      const cachedAncestor = cache.get(currentParentId);
      if (cachedAncestor !== undefined) {
        parts.unshift(cachedAncestor);
        break;
      }

      const parent = await (this.db as any).repositoryFolders.findUnique({
        where: { id: currentParentId },
      });
      if (!parent) break;
      parts.unshift(parent.name);
      currentParentId = parent.parentId;
      depth++;
    }

    const path = parts.join(" / ");
    cache.set(folder.id, path);
    return path;
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
        "Suggest ONLY tags from the EXISTING PROJECT TAGS list. Do not invent new tags."
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
