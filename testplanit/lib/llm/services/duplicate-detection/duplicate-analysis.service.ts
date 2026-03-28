import { LLM_FEATURES } from "~/lib/llm/constants";
import type { LlmManager } from "~/lib/llm/services/llm-manager.service";
import type { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";
import type { SimilarCasePair } from "~/lib/services/duplicateScanService";
import { createBatches, executeBatches } from "~/lib/llm/services/batch-processor";

/**
 * Input type: SimilarCasePair enriched with case content for LLM prompt building.
 * The content fields are stripped from output.
 */
export interface PairWithCaseContent extends SimilarCasePair {
  caseAName: string;
  /** Formatted multi-line steps: "Step 1: ...\nExpected: ..." */
  caseASteps: string;
  caseBName: string;
  caseBSteps: string;
}

/**
 * Output type: SimilarCasePair annotated with detectionMethod.
 */
export type AnnotatedPair = SimilarCasePair & { detectionMethod: string };

/**
 * Internal batchable item — PairWithCaseContent plus id and estimatedTokens
 * required by the shared batch-processor infrastructure.
 */
interface PairBatchableItem extends PairWithCaseContent {
  id: number;
  estimatedTokens: number;
}

/**
 * LLM response shape for duplicate detection.
 */
interface LlmDuplicateResponse {
  results: Array<{ pairIndex: number; verdict: string }>;
}

/**
 * DuplicateAnalysisService — sends candidate duplicate pairs to the LLM in
 * batches for semantic "same functionality?" verification.
 *
 * This is an additive, optional layer on top of fuzzy scoring:
 * - When no LLM is configured: all pairs returned unchanged as "fuzzy"
 * - LLM-confirmed (YES) pairs: confidence upgraded to HIGH, method "semantic"
 * - LLM-rejected (NO) pairs: removed from results
 * - Failed batch pairs: kept unchanged with method "fuzzy"
 *
 * Batch sizes are driven by maxTokensPerRequest (from the provider config)
 * rather than hardcoded constants. Truncated responses, timeouts, and parse
 * failures trigger a recursive split-in-half retry up to depth 3.
 */
export class DuplicateAnalysisService {
  constructor(
    private llmManager: LlmManager,
    private promptResolver: PromptResolver,
  ) {}

  /**
   * Analyze candidate pairs using LLM semantic verification.
   *
   * @param pairs - Candidate pairs with case content for LLM prompt building
   * @param projectId - Project scope (used for integration resolution)
   * @param userId - User ID for LLM call tracking
   * @param maxTokensPerRequest - Provider context window size (from LlmProviderConfig)
   * @param retryOptions - Optional retry settings passed through to manager.chat()
   * @returns Annotated pairs (input-only content fields stripped)
   */
  async analyzePairs(
    pairs: PairWithCaseContent[],
    projectId: number,
    userId: string,
    maxTokensPerRequest: number,
    retryOptions?: { maxRetries?: number; baseDelayMs?: number },
    onProgress?: (analyzed: number, total: number) => Promise<void>,
  ): Promise<AnnotatedPair[]> {
    // 1. Empty input fast path
    if (pairs.length === 0) {
      return [];
    }

    // 2. Resolve LLM integration — graceful no-op if not configured
    const resolved = await this.llmManager.resolveIntegration(
      LLM_FEATURES.DUPLICATE_DETECTION,
      projectId,
    );

    if (!resolved) {
      return pairs.map((p) => this.stripContentFields({ ...p, detectionMethod: "fuzzy" }));
    }

    const integrationId = resolved.integrationId;

    // 3. Assign id + estimatedTokens to each pair for the batch processor
    const pairsWithTokens: PairBatchableItem[] = pairs.map((p, index) => ({
      ...p,
      id: index,
      estimatedTokens: Math.ceil(
        (p.caseAName + p.caseASteps + p.caseBName + p.caseBSteps).length / 4,
      ),
    }));

    // 4. Estimate system prompt overhead
    const systemPromptTokens = Math.ceil(this.buildSystemPrompt().length / 4);

    // 5. Create token-aware batches
    const batches = createBatches(
      pairsWithTokens,
      {
        maxTokensPerRequest,
        contentBudgetRatio: 0.65,
        systemPromptTokens,
      },
      // Truncate oversized items: shorten steps to fit within budget
      (item, maxChars) => {
        const halfChars = Math.floor(maxChars / 2);
        return {
          ...item,
          caseASteps: item.caseASteps.slice(0, halfChars),
          caseBSteps: item.caseBSteps.slice(0, halfChars),
          estimatedTokens: Math.ceil(
            (
              item.caseAName +
              item.caseASteps.slice(0, halfChars) +
              item.caseBName +
              item.caseBSteps.slice(0, halfChars)
            ).length / 4,
          ),
        };
      },
    );

    // 6. Cap at MAX_BATCHES; overflow returned as fuzzy without LLM analysis
    const MAX_BATCHES = 10;
    const cappedBatches = batches.slice(0, MAX_BATCHES);
    const overflowBatches = batches.slice(MAX_BATCHES);

    // 7. Accumulate results via side-effect inside processWithRetry
    const processedPairs: AnnotatedPair[] = [];
    let pairsAnalyzed = 0;
    const totalPairsForLlm = cappedBatches.reduce((s, b) => s + b.length, 0);

    /**
     * Process a batch of pairs, retrying with split-in-half sub-batches when:
     *   - The LLM call times out
     *   - The response is truncated (finishReason === "length")
     *   - The response JSON cannot be parsed
     * Maximum recursion depth is 3 to prevent runaway splitting.
     *
     * `maxWorkingBatchSize` remembers the largest batch size that succeeded
     * so subsequent batches are pre-split without re-discovering timeouts.
     */
    let maxWorkingBatchSize = Infinity;

    const processWithRetry = async (
      batch: PairBatchableItem[],
      depth: number = 0,
    ): Promise<void> => {
      // Pre-split if we already know a smaller size works
      if (batch.length > maxWorkingBatchSize) {
        const chunks: PairBatchableItem[][] = [];
        for (let i = 0; i < batch.length; i += maxWorkingBatchSize) {
          chunks.push(batch.slice(i, i + maxWorkingBatchSize));
        }
        for (const chunk of chunks) {
          await processWithRetry(chunk, depth);
        }
        return;
      }
      let response;
      try {
        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(batch);
        response = await this.llmManager.chat(
          integrationId,
          {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.1,
            maxTokens: 512,
            userId,
            projectId,
            feature: LLM_FEATURES.DUPLICATE_DETECTION,
          } as any,
          retryOptions,
        );
      } catch (error: any) {
        // Timeout: split and retry if batch > 1 and depth < 3
        const isTimeout =
          error?.code === "TIMEOUT" ||
          error?.message?.includes("timeout") ||
          error?.message?.includes("Timeout");
        if (isTimeout && batch.length > 1 && depth < 3) {
          const mid = Math.ceil(batch.length / 2);
          maxWorkingBatchSize = Math.min(maxWorkingBatchSize, mid);
          console.warn(
            `[duplicate-detection] Timeout for batch of ${batch.length}, retrying as 2 sub-batches of ${mid} (maxWorkingBatchSize now ${maxWorkingBatchSize})`,
          );
          await processWithRetry(batch.slice(0, mid), depth + 1);
          await processWithRetry(batch.slice(mid), depth + 1);
          return;
        }
        // Not retryable — let executeBatches catch it and record failed IDs
        throw error;
      }

      // Check for truncated response
      if (response.finishReason === "length" && batch.length > 1 && depth < 3) {
        const mid = Math.ceil(batch.length / 2);
        console.warn(
          `[duplicate-detection] Truncated response for batch of ${batch.length}, retrying as 2 sub-batches (depth ${depth + 1})`,
        );
        await processWithRetry(batch.slice(0, mid), depth + 1);
        await processWithRetry(batch.slice(mid), depth + 1);
        return;
      }

      // Parse response
      const verdicts = this.parseResponse(response.content);

      if (!verdicts) {
        // Parse failure: split and retry if batch > 1 and depth < 3
        if (batch.length > 1 && depth < 3) {
          const mid = Math.ceil(batch.length / 2);
          console.warn(
            `[duplicate-detection] Parse failed for batch of ${batch.length}, retrying as 2 sub-batches (depth ${depth + 1})`,
          );
          await processWithRetry(batch.slice(0, mid), depth + 1);
          await processWithRetry(batch.slice(mid), depth + 1);
          return;
        }
        // Can't split further — fall back to fuzzy for remaining pairs
        processedPairs.push(
          ...batch.map((p) => this.stripContentFields({ ...p, detectionMethod: "fuzzy" })),
        );
        return;
      }

      // Build verdict map and annotate pairs
      const verdictMap = new Map<number, string>(
        verdicts.map((v) => [v.pairIndex, v.verdict]),
      );

      for (let i = 0; i < batch.length; i++) {
        const pair = batch[i]!;
        const verdict = verdictMap.get(i);

        if (verdict === "YES") {
          processedPairs.push(
            this.stripContentFields({ ...pair, confidence: "HIGH", detectionMethod: "semantic" }),
          );
        } else if (verdict === "NO") {
          // Rejected — exclude from results
          continue;
        } else {
          // Missing from response — conservative fuzzy fallback
          processedPairs.push(
            this.stripContentFields({ ...pair, detectionMethod: "fuzzy" }),
          );
        }
      }

      // Report sub-batch progress
      pairsAnalyzed += batch.length;
      if (onProgress) {
        await onProgress(pairsAnalyzed, totalPairsForLlm);
      }
    };

    // 8. Execute all capped batches with per-batch error isolation
    const batchResult = await executeBatches({
      batches: cappedBatches,
      processBatch: async (batch) => {
        await processWithRetry(batch);
      },
    });

    // 9. For batches that failed entirely, fall back failed pairs to fuzzy
    if (batchResult.failedItemIds.length > 0) {
      const failedPairSet = new Set(batchResult.failedItemIds);
      for (const p of pairsWithTokens) {
        if (failedPairSet.has(p.id)) {
          processedPairs.push(
            this.stripContentFields({ ...p, detectionMethod: "fuzzy" }),
          );
        }
      }
    }

    // 10. Overflow batches beyond MAX_BATCHES cap — returned as fuzzy
    const overflowPairs: AnnotatedPair[] = overflowBatches
      .flat()
      .map((p) => this.stripContentFields({ ...p, detectionMethod: "fuzzy" }));

    return [...processedPairs, ...overflowPairs];
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Build the system prompt instructing the LLM to respond with JSON verdicts.
   */
  private buildSystemPrompt(): string {
    return (
      `You are a duplicate test case detector. For each pair, respond with YES if both cases ` +
      `test the same functionality, NO if they test different things. ` +
      `Respond ONLY with valid JSON: { "results": [{"pairIndex": 0, "verdict": "YES"}, ...] }`
    );
  }

  /**
   * Build the user prompt listing each pair's case content.
   */
  private buildUserPrompt(pairs: PairWithCaseContent[]): string {
    const parts: string[] = [];

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i]!;
      parts.push(`Pair ${i}:`);
      parts.push(`  Case A: ${pair.caseAName}`);
      parts.push(`  Case A Steps:\n${pair.caseASteps}`);
      parts.push(`  Case B: ${pair.caseBName}`);
      parts.push(`  Case B Steps:\n${pair.caseBSteps}`);
      parts.push("");
    }

    return parts.join("\n");
  }

  /**
   * Parse the LLM response JSON.
   * Returns null if parsing fails.
   */
  private parseResponse(
    content: string,
  ): Array<{ pairIndex: number; verdict: string }> | null {
    try {
      let jsonStr = content.trim();

      // Strip markdown code fences if present
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, "");
        jsonStr = jsonStr.replace(/\n?```\s*$/, "");
        jsonStr = jsonStr.trim();
      }

      const parsed = JSON.parse(jsonStr) as LlmDuplicateResponse;

      if (!parsed.results || !Array.isArray(parsed.results)) {
        return null;
      }

      return parsed.results;
    } catch {
      return null;
    }
  }

  /**
   * Strip PairWithCaseContent input-only fields from the annotated output.
   * Returns a clean AnnotatedPair (SimilarCasePair + detectionMethod only).
   */
  private stripContentFields(
    pair: PairWithCaseContent & { detectionMethod: string },
  ): AnnotatedPair {
    const { caseAName: _a, caseASteps: _b, caseBName: _c, caseBSteps: _d, ...rest } = pair;
    return rest;
  }
}
