import { estimatePromptTokens } from "~/lib/llm/content";
import {
  createBatches,
  executeBatches,
  type BatchableItem,
} from "~/lib/llm/services/batch-processor";
import type { LlmRequest, LlmResponse } from "~/lib/llm/types/index";
import {
  mergeAiBatches,
  toAiLayer,
  validateAiBatch,
  type AiBatchResult,
} from "../aiOutput";
import type { ImpactConfig } from "../config";
import {
  buildUserPrompt,
  estimateFixedPromptTokens,
  type CompressedCase,
} from "../promptBuilder";
import type { AnalysisWarning, LayerResult } from "../types";

export interface AiLayerLlm {
  chat(
    integrationId: number,
    request: LlmRequest,
    retryOptions?: { maxRetries?: number; baseDelayMs?: number }
  ): Promise<LlmResponse>;
}

export interface AiLayerDeps {
  llm: AiLayerLlm;
  feature: string;
  isCancelled: () => Promise<boolean>;
  onBatchComplete?: (processed: number, total: number) => Promise<void>;
}

export interface AiLayerInput {
  integrationId: number;
  model?: string;
  systemPrompt: string;
  userTemplate: string;
  temperature: number;
  maxOutputTokens: number;
  maxTokensPerRequest: number;
  retryOptions?: { maxRetries?: number; baseDelayMs?: number };
  userId: string;
  projectId: number;
  analysisId: number;
  baseSha: string;
  headSha: string;
  notes?: string;
  diffText: string;
  changedFileCount: number;
  excludedCount: number;
  changedPaths: string[];
  pinnedCaseIds: number[];
  candidates: CompressedCase[];
  cfg: Pick<ImpactConfig, "thinkingBudget">;
}

export interface AiLayerOutput {
  layer: LayerResult;
  summary: string;
  uncoveredFiles: string[];
  stats: {
    model: string;
    tokens: { prompt: number; completion: number; total: number };
    batchCount: number;
    failedBatchCount: number;
    truncatedBatches: number[];
  };
  warnings: AnalysisWarning[];
  cancelled: boolean;
}

type CaseItem = CompressedCase & BatchableItem;

const OUTPUT_TOKENS_PER_CASE = 60;
const OUTPUT_TOKENS_RESERVE = 500;
const LLM_TIMEOUT_MS = 240_000;

function maxItemsPerBatch(maxOutputTokens: number): number {
  const fit = Math.floor(
    (maxOutputTokens - OUTPUT_TOKENS_RESERVE) / OUTPUT_TOKENS_PER_CASE
  );
  return Math.min(200, Math.max(20, fit));
}

/**
 * Layer 3: the LLM ranks candidate cases against the diff summary. Cases are
 * batched to fit the provider's context window; a batch whose output was cut
 * off is salvaged, then split and retried once.
 */
export async function runAiLayer(
  deps: AiLayerDeps,
  input: AiLayerInput
): Promise<AiLayerOutput> {
  const warnings: AnalysisWarning[] = [];
  const truncatedBatches: number[] = [];
  const tokens = { prompt: 0, completion: 0, total: 0 };
  let model = input.model ?? "";
  const changedPaths = new Set(input.changedPaths);

  const items: CaseItem[] = input.candidates.map((candidate) => ({
    ...candidate,
    estimatedTokens: estimatePromptTokens([
      { role: "user", content: JSON.stringify(candidate) },
    ]),
  }));
  const systemPromptTokens = estimateFixedPromptTokens(
    input.systemPrompt,
    input.userTemplate,
    input.diffText
  );
  const batches = createBatches(items, {
    maxTokensPerRequest: input.maxTokensPerRequest,
    systemPromptTokens,
    maxItemsPerBatch: maxItemsPerBatch(input.maxOutputTokens),
  });

  const callLlm = async (
    batch: CaseItem[],
    batchIndex: number,
    batchCount: number
  ): Promise<AiBatchResult> => {
    const userPrompt = buildUserPrompt(input.userTemplate, {
      baseSha: input.baseSha,
      headSha: input.headSha,
      notes: input.notes,
      diffText: input.diffText,
      changedFileCount: input.changedFileCount,
      excludedCount: input.excludedCount,
      pinnedCaseIds: input.pinnedCaseIds,
      candidates: batch,
      batchIndex,
      batchCount,
    });
    const request: LlmRequest = {
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: input.temperature,
      maxTokens: input.maxOutputTokens,
      userId: input.userId,
      projectId: input.projectId,
      feature: deps.feature,
      ...(input.model ? { model: input.model } : {}),
      ...(input.cfg.thinkingBudget > 0
        ? { thinkingBudget: input.cfg.thinkingBudget }
        : {}),
      metadata: {
        projectId: input.projectId,
        analysisId: input.analysisId,
        batchIndex,
        candidateCount: batch.length,
        timestamp: new Date().toISOString(),
      },
      timeout: LLM_TIMEOUT_MS,
    };
    const response = await deps.llm.chat(
      input.integrationId,
      request,
      input.retryOptions
    );
    tokens.prompt += response.promptTokens;
    tokens.completion += response.completionTokens;
    tokens.total += response.totalTokens;
    model = response.model || model;
    if (response.finishReason === "length") truncatedBatches.push(batchIndex);
    return validateAiBatch(response.content, {
      validIds: new Set(batch.map((c) => c.id)),
      changedPaths,
      batchIndex,
      finishReason: response.finishReason,
    });
  };

  const execution = await executeBatches<CaseItem, AiBatchResult>({
    batches,
    processBatch: async (batch, batchIndex) => {
      const first = await callLlm(batch, batchIndex, batches.length);
      const cutOff =
        truncatedBatches.includes(batchIndex) && first.selections.length === 0;
      if (!cutOff || batch.length < 2) return first;
      const mid = Math.ceil(batch.length / 2);
      const halves = [batch.slice(0, mid), batch.slice(mid)];
      const parts: AiBatchResult[] = [];
      for (const half of halves) {
        if (await deps.isCancelled()) break;
        parts.push(await callLlm(half, batchIndex, batches.length));
      }
      return {
        batchIndex,
        selections: parts.flatMap((p) => p.selections),
        uncoveredFiles: parts.flatMap((p) => p.uncoveredFiles),
        summary: parts.find((p) => p.summary)?.summary ?? "",
        partial: true,
        droppedIds: parts.flatMap((p) => p.droppedIds),
      };
    },
    onBatchComplete: deps.onBatchComplete,
    isCancelled: deps.isCancelled,
  });

  const merged = mergeAiBatches(execution.results);
  if (
    execution.failedBatchCount > 0 ||
    execution.results.some((r) => r.parseError)
  ) {
    warnings.push({
      code: "ai_partial",
      detail: {
        failedBatchCount: execution.failedBatchCount,
        errors: execution.errors.slice(0, 5),
      },
    });
  }
  if (truncatedBatches.length > 0) {
    warnings.push({ code: "ai_truncated", detail: { truncatedBatches } });
  }

  return {
    layer: toAiLayer(merged),
    summary: merged.summary,
    uncoveredFiles: merged.uncoveredFiles,
    stats: {
      model,
      tokens,
      batchCount: execution.batchCount,
      failedBatchCount: execution.failedBatchCount,
      truncatedBatches,
    },
    warnings,
    cancelled: execution.cancelled,
  };
}
