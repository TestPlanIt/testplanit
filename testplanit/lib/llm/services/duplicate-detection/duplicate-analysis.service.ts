import { LLM_FEATURES } from "~/lib/llm/constants";
import type { LlmManager } from "~/lib/llm/services/llm-manager.service";
import type { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";
import type { SimilarCasePair } from "~/lib/services/duplicateScanService";

export const BATCH_SIZE = 10;
export const MAX_PAIRS_PER_SCAN = 50;

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
   * @returns Annotated pairs (input-only content fields stripped)
   */
  async analyzePairs(
    pairs: PairWithCaseContent[],
    projectId: number,
    userId: string,
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

    // 3. Cap at MAX_PAIRS_PER_SCAN; overflow returns as fuzzy unchanged
    const capped = pairs.slice(0, MAX_PAIRS_PER_SCAN);
    const overflow = pairs.slice(MAX_PAIRS_PER_SCAN);

    // 4. Build batches of BATCH_SIZE
    const batches: PairWithCaseContent[][] = [];
    for (let i = 0; i < capped.length; i += BATCH_SIZE) {
      batches.push(capped.slice(i, i + BATCH_SIZE));
    }

    // 5. Process each batch
    const processedPairs: AnnotatedPair[] = [];

    for (const batch of batches) {
      let batchResults: AnnotatedPair[];

      try {
        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(batch);

        const response = await this.llmManager.chat(integrationId, {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          maxTokens: 512,
          userId,
          projectId,
          feature: LLM_FEATURES.DUPLICATE_DETECTION,
        } as any);

        const verdicts = this.parseResponse(response.content);

        if (!verdicts) {
          // Parse failure — keep all batch pairs as fuzzy
          batchResults = batch.map((p) =>
            this.stripContentFields({ ...p, detectionMethod: "fuzzy" }),
          );
        } else {
          // Build lookup from pairIndex → verdict
          const verdictMap = new Map<number, string>(
            verdicts.map((v) => [v.pairIndex, v.verdict]),
          );

          batchResults = [];
          for (let i = 0; i < batch.length; i++) {
            const pair = batch[i]!;
            const verdict = verdictMap.get(i);

            if (verdict === "YES") {
              // Confirmed duplicate: upgrade confidence and mark semantic
              batchResults.push(
                this.stripContentFields({
                  ...pair,
                  confidence: "HIGH",
                  detectionMethod: "semantic",
                }),
              );
            } else if (verdict === "NO") {
              // Rejected: exclude from results
              continue;
            } else {
              // Missing from response: conservative fuzzy fallback
              batchResults.push(
                this.stripContentFields({ ...pair, detectionMethod: "fuzzy" }),
              );
            }
          }
        }
      } catch {
        // LLM call error — keep all batch pairs as fuzzy
        batchResults = batch.map((p) =>
          this.stripContentFields({ ...p, detectionMethod: "fuzzy" }),
        );
      }

      processedPairs.push(...batchResults);
    }

    // 6. Concat processed results + overflow pairs
    const overflowPairs = overflow.map((p) =>
      this.stripContentFields({ ...p, detectionMethod: "fuzzy" }),
    );

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
