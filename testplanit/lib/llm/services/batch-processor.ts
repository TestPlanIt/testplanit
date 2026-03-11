/**
 * Shared LLM batch processor utility.
 *
 * Provides token-aware batching for any feature that needs to split work
 * across multiple LLM calls. Handles:
 * - Dynamic batch sizing based on token budgets
 * - Oversized item truncation
 * - Sequential batch execution with progress callbacks
 * - Per-batch error isolation (one failure doesn't stop the rest)
 * - Cancellation support between batches
 */

/** Any item that can be batched must have an id and estimated token count. */
export interface BatchableItem {
  id: number;
  estimatedTokens: number;
}

/** Configuration for how to split items into batches. */
export interface BatchConfig {
  /** Max context window tokens for the LLM provider. */
  maxTokensPerRequest: number;
  /**
   * Fraction of maxTokensPerRequest reserved for user content (the rest is
   * for the system prompt overhead and response tokens).
   * @default 0.65
   */
  contentBudgetRatio?: number;
  /** Estimated token count of the system prompt + any fixed per-request overhead. */
  systemPromptTokens: number;
  /** Optional hard cap on items per batch (e.g. to keep output within maxOutputTokens). */
  maxItemsPerBatch?: number;
}

const DEFAULT_CONTENT_BUDGET_RATIO = 0.65;

/**
 * Split items into batches that fit within the token budget.
 *
 * - Items that fit are grouped respecting both token budget and item count limit.
 * - Oversized items (exceeding budget alone) are truncated via the optional
 *   `truncateItem` callback and placed in their own batch.
 * - If no `truncateItem` is provided, oversized items go into a solo batch as-is.
 */
export function createBatches<T extends BatchableItem>(
  items: T[],
  config: BatchConfig,
  truncateItem?: (item: T, maxChars: number) => T,
): T[][] {
  if (items.length === 0) return [];

  const ratio = config.contentBudgetRatio ?? DEFAULT_CONTENT_BUDGET_RATIO;
  const contentBudget = Math.floor(
    config.maxTokensPerRequest * ratio - config.systemPromptTokens,
  );

  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentTokens = 0;

  for (const item of items) {
    // Oversized item: truncate (if possible) and give it its own batch
    if (item.estimatedTokens > contentBudget) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }

      if (truncateItem) {
        const maxChars = contentBudget * 4; // ~1 token per 4 chars
        batches.push([truncateItem(item, maxChars)]);
      } else {
        batches.push([item]);
      }
      continue;
    }

    const maxPerBatch = config.maxItemsPerBatch ?? Infinity;
    if (
      currentTokens + item.estimatedTokens > contentBudget ||
      currentBatch.length >= maxPerBatch
    ) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      currentBatch = [item];
      currentTokens = item.estimatedTokens;
    } else {
      currentBatch.push(item);
      currentTokens += item.estimatedTokens;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

// ── Batch execution ──────────────────────────────────────────────────────

/** Options for running batches through an LLM. */
export interface BatchExecutionOptions<T extends BatchableItem, TResult> {
  /** Pre-created batches (from `createBatches`). */
  batches: T[][];
  /** Called for each batch — should make the LLM call and return parsed results. */
  processBatch: (batch: T[], batchIndex: number) => Promise<TResult>;
  /** Optional progress callback fired after each batch (even on failure). */
  onBatchComplete?: (processed: number, total: number) => Promise<void>;
  /** Optional cancellation check called between batches. */
  isCancelled?: () => Promise<boolean>;
}

/** Aggregated result of processing all batches. */
export interface BatchExecutionResult<TResult> {
  /** Collected results from successful batches. */
  results: TResult[];
  /** Total number of batches processed (including failures). */
  batchCount: number;
  /** Number of batches that threw an error. */
  failedBatchCount: number;
  /** Error messages from failed batches. */
  errors: string[];
  /** Item IDs from failed batches. */
  failedItemIds: number[];
  /** True if processing was cancelled before all batches completed. */
  cancelled: boolean;
}

/**
 * Execute batches sequentially with error isolation and optional cancellation.
 *
 * Each batch is processed independently — a failure in one batch does not
 * prevent subsequent batches from running. Failed item IDs and error messages
 * are collected in the result.
 */
export async function executeBatches<T extends BatchableItem, TResult>(
  options: BatchExecutionOptions<T, TResult>,
): Promise<BatchExecutionResult<TResult>> {
  const { batches, processBatch, onBatchComplete, isCancelled } = options;

  const totalItems = batches.reduce((sum, b) => sum + b.length, 0);
  const results: TResult[] = [];
  let processedItems = 0;
  let failedBatchCount = 0;
  const errors: string[] = [];
  const failedItemIds: number[] = [];
  let cancelled = false;

  for (let i = 0; i < batches.length; i++) {
    // Check cancellation before each batch
    if (isCancelled) {
      const shouldCancel = await isCancelled();
      if (shouldCancel) {
        cancelled = true;
        break;
      }
    }

    const batch = batches[i]!;

    try {
      const result = await processBatch(batch, i);
      results.push(result);
    } catch (error) {
      failedBatchCount++;
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(msg);
      failedItemIds.push(...batch.map((item) => item.id));
      console.warn(
        `[batch-processor] Batch ${i + 1}/${batches.length} failed (${batch.length} items): ${msg}`,
      );
    }

    processedItems += batch.length;
    if (onBatchComplete) {
      await onBatchComplete(processedItems, totalItems);
    }
  }

  return {
    results,
    batchCount: batches.length,
    failedBatchCount,
    errors,
    failedItemIds,
    cancelled,
  };
}
