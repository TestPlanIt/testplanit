import { beforeEach, describe, expect, it, vi } from "vitest";

import { LLM_FEATURES } from "~/lib/llm/constants";

import { DuplicateAnalysisService } from "./duplicate-analysis.service";
import type { PairWithCaseContent } from "./duplicate-analysis.service";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockLlmManager = {
  resolveIntegration: vi.fn(),
  chat: vi.fn(),
} as any;

const mockPromptResolver = {
  resolve: vi.fn(),
} as any;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePair(
  caseAId: number,
  caseBId: number,
  overrides: Partial<PairWithCaseContent> = {},
): PairWithCaseContent {
  return {
    caseAId,
    caseBId,
    score: 0.75,
    confidence: "MEDIUM",
    matchedFields: ["name"],
    caseAName: `Case ${caseAId}`,
    caseASteps: `Step 1: Do something\nExpected: Something happens`,
    caseBName: `Case ${caseBId}`,
    caseBSteps: `Step 1: Do the same thing\nExpected: Same thing happens`,
    ...overrides,
  };
}

function makePairs(count: number): PairWithCaseContent[] {
  return Array.from({ length: count }, (_, i) => makePair(i + 1, i + 100));
}

// A small token budget that fits exactly 2 pairs per batch (for batch-count tests)
// Each pair has ~5 tokens of content; system prompt ~20 tokens.
// Budget with ratio 0.65: floor(200 * 0.65) - 20 = 110 tokens → ~22 pairs fit easily.
// Use a tiny budget of 50 tokens: floor(50 * 0.65) - 20 = 12 tokens → ~2 pairs per batch.
const TINY_TOKEN_BUDGET = 50;

// A large token budget so all pairs fit in one batch
const LARGE_TOKEN_BUDGET = 128_000;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DuplicateAnalysisService", () => {
  let service: DuplicateAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DuplicateAnalysisService(mockLlmManager, mockPromptResolver);
  });

  // ── Test 1: Empty pairs array ─────────────────────────────────────────────

  it("returns empty array when given no pairs", async () => {
    const result = await service.analyzePairs([], 1, "user-1", LARGE_TOKEN_BUDGET);
    expect(result).toEqual([]);
    expect(mockLlmManager.resolveIntegration).not.toHaveBeenCalled();
  });

  // ── Test 2: No LLM configured ─────────────────────────────────────────────

  it("returns all input pairs unchanged with detectionMethod 'fuzzy' when no LLM is configured", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue(null);

    const pairs = makePairs(3);
    const result = await service.analyzePairs(pairs, 1, "user-1", LARGE_TOKEN_BUDGET);

    expect(result).toHaveLength(3);
    for (const item of result) {
      expect(item.detectionMethod).toBe("fuzzy");
      // Input-only fields stripped
      expect((item as any).caseAName).toBeUndefined();
      expect((item as any).caseASteps).toBeUndefined();
      expect((item as any).caseBName).toBeUndefined();
      expect((item as any).caseBSteps).toBeUndefined();
    }

    expect(mockLlmManager.chat).not.toHaveBeenCalled();
  });

  // ── Test 3: LLM confirms (YES) and rejects (NO) pairs ────────────────────

  it("upgrades confidence to HIGH and marks semantic for YES pairs, removes NO pairs", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });
    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({
        results: [
          { pairIndex: 0, verdict: "YES" },
          { pairIndex: 1, verdict: "NO" },
        ],
      }),
      totalTokens: 100,
    });

    const pairs = [makePair(1, 101), makePair(2, 102)];
    const result = await service.analyzePairs(pairs, 1, "user-1", LARGE_TOKEN_BUDGET);

    // Only pair 0 (YES) kept
    expect(result).toHaveLength(1);
    const confirmed = result[0]!;
    expect(confirmed.caseAId).toBe(1);
    expect(confirmed.caseBId).toBe(101);
    expect(confirmed.confidence).toBe("HIGH");
    expect(confirmed.detectionMethod).toBe("semantic");

    // Input-only fields stripped
    expect((confirmed as any).caseAName).toBeUndefined();
    expect((confirmed as any).caseASteps).toBeUndefined();
  });

  // ── Test 4: MAX_BATCHES cap — excess batches returned as fuzzy ───────────

  it("returns pairs beyond 10-batch cap as fuzzy without LLM analysis", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });

    // Use a tiny token budget so each pair gets its own batch
    // With TINY_TOKEN_BUDGET (50), system prompt alone may exceed budget —
    // use slightly larger budget so pairs still batch but we exceed 10 batches
    // Each pair content is ~12 tokens; system prompt ~20 tokens.
    // Budget: floor(120 * 0.65) - 20 = 58 tokens → ~4 pairs per batch.
    // 50 pairs / 4 per batch = ~13 batches > 10 cap.
    const TOKEN_BUDGET_FOR_OVERFLOW = 120;

    mockLlmManager.chat.mockImplementation((_id: number, req: any) => {
      const userContent: string = req.messages[1].content;
      const pairCount = (userContent.match(/Pair \d+:/g) ?? []).length;
      const results = Array.from({ length: pairCount }, (_, i) => ({
        pairIndex: i,
        verdict: "YES",
      }));
      return Promise.resolve({
        content: JSON.stringify({ results }),
        totalTokens: 50,
      });
    });

    const pairs = makePairs(50);
    const result = await service.analyzePairs(pairs, 1, "user-1", TOKEN_BUDGET_FOR_OVERFLOW);

    // All 50 pairs returned (some semantic, some fuzzy overflow)
    expect(result).toHaveLength(50);

    // At most 10 batches processed by LLM
    expect(mockLlmManager.chat.mock.calls.length).toBeLessThanOrEqual(10);

    // Pairs in overflow batches come back as fuzzy
    const fuzzyPairs = result.filter((r) => r.detectionMethod === "fuzzy");
    expect(fuzzyPairs.length).toBeGreaterThan(0);

    // Overflow pairs have original confidence unchanged
    for (const fp of fuzzyPairs) {
      expect(fp.confidence).toBe("MEDIUM");
    }
  });

  // ── Test 5: Token-based batching — fewer batches with larger budget ───────

  it("creates fewer batches with larger maxTokensPerRequest (BATCH-01)", async () => {
    const chatImpl = (_id: number, req: any) => {
      const userContent: string = req.messages[1].content;
      const pairCount = (userContent.match(/Pair \d+:/g) ?? []).length;
      const results = Array.from({ length: pairCount }, (_, i) => ({
        pairIndex: i,
        verdict: "YES",
      }));
      return Promise.resolve({
        content: JSON.stringify({ results }),
        totalTokens: 50,
        finishReason: "stop",
      });
    };

    const pairs = makePairs(10);

    // Small budget — more batches
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });
    mockLlmManager.chat.mockImplementation(chatImpl);
    await service.analyzePairs(pairs, 1, "user-1", TINY_TOKEN_BUDGET);
    const smallBudgetCalls = mockLlmManager.chat.mock.calls.length;

    vi.clearAllMocks();

    // Large budget — fewer batches (all 10 pairs fit in one batch)
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });
    mockLlmManager.chat.mockImplementation(chatImpl);
    await service.analyzePairs(pairs, 1, "user-1", LARGE_TOKEN_BUDGET);
    const largeBudgetCalls = mockLlmManager.chat.mock.calls.length;

    expect(largeBudgetCalls).toBeLessThan(smallBudgetCalls);
  });

  // ── Test 6: LLM error for one batch — keep that batch as fuzzy ────────────

  it("keeps batch pairs as fuzzy when LLM call throws an error for that batch", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });

    let callCount = 0;
    mockLlmManager.chat.mockImplementation((_id: number, req: any) => {
      callCount++;
      if (callCount === 1) {
        // First batch succeeds with YES
        const userContent: string = req.messages[1].content;
        const pairCount = (userContent.match(/Pair \d+:/g) ?? []).length;
        const results = Array.from({ length: pairCount }, (_, i) => ({
          pairIndex: i,
          verdict: "YES",
        }));
        return Promise.resolve({
          content: JSON.stringify({ results }),
          totalTokens: 50,
        });
      }
      // Second batch throws (not a timeout — won't trigger retry split)
      return Promise.reject(new Error("LLM network error"));
    });

    // TINY_TOKEN_BUDGET ensures at least 2 batches for 5 pairs
    const pairs = makePairs(5);
    const result = await service.analyzePairs(pairs, 1, "user-1", TINY_TOKEN_BUDGET);

    // All pairs returned — first batch semantic, second batch fuzzy
    expect(result).toHaveLength(5);

    const semanticPairs = result.filter((r) => r.detectionMethod === "semantic");
    const fuzzyPairs = result.filter((r) => r.detectionMethod === "fuzzy");

    expect(semanticPairs.length).toBeGreaterThan(0);
    expect(fuzzyPairs.length).toBeGreaterThan(0);
    expect(semanticPairs.length + fuzzyPairs.length).toBe(5);
  });

  // ── Test 7: Unparseable JSON → split-retry then fuzzy ────────────────────

  it("keeps batch pairs as fuzzy when LLM returns unparseable JSON and batch cannot split", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });
    // All calls return bad JSON; with a single pair it can't split further
    mockLlmManager.chat.mockResolvedValue({
      content: "This is not valid JSON { broken",
      totalTokens: 10,
      finishReason: "stop",
    });

    const pairs = [makePair(1, 101)]; // Single pair — can't split further
    const result = await service.analyzePairs(pairs, 1, "user-1", LARGE_TOKEN_BUDGET);

    expect(result).toHaveLength(1);
    expect(result[0]!.detectionMethod).toBe("fuzzy");
  });

  // ── LLM call params validation ────────────────────────────────────────────

  it("calls LLM with correct parameters including feature, temperature, and retryOptions", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 99 });
    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({ results: [{ pairIndex: 0, verdict: "YES" }] }),
      totalTokens: 50,
    });

    const pairs = [makePair(1, 101)];
    const retryOptions = { maxRetries: 2, baseDelayMs: 500 };
    await service.analyzePairs(pairs, 5, "user-xyz", LARGE_TOKEN_BUDGET, retryOptions);

    expect(mockLlmManager.resolveIntegration).toHaveBeenCalledWith(
      LLM_FEATURES.DUPLICATE_DETECTION,
      5,
    );

    const chatCall = mockLlmManager.chat.mock.calls[0]!;
    expect(chatCall[0]).toBe(99);
    expect(chatCall[1].temperature).toBe(0.1);
    expect(chatCall[1].feature).toBe(LLM_FEATURES.DUPLICATE_DETECTION);
    expect(chatCall[1].userId).toBe("user-xyz");
    expect(chatCall[1].projectId).toBe(5);
    // retryOptions passed as third argument
    expect(chatCall[2]).toEqual(retryOptions);
  });

  // ── Pairs missing from response → kept as fuzzy ──────────────────────────

  it("keeps pairs missing from LLM response as fuzzy (conservative fallback)", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });
    // Response only covers pairIndex 0, not 1
    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({
        results: [{ pairIndex: 0, verdict: "YES" }],
      }),
      totalTokens: 50,
    });

    const pairs = [makePair(1, 101), makePair(2, 102)];
    const result = await service.analyzePairs(pairs, 1, "user-1", LARGE_TOKEN_BUDGET);

    // Pair 0 YES → semantic HIGH; pair 1 missing → fuzzy
    expect(result).toHaveLength(2);
    const semantic = result.find((r) => r.caseAId === 1)!;
    const fuzzy = result.find((r) => r.caseAId === 2)!;

    expect(semantic.detectionMethod).toBe("semantic");
    expect(semantic.confidence).toBe("HIGH");
    expect(fuzzy.detectionMethod).toBe("fuzzy");
    expect(fuzzy.confidence).toBe("MEDIUM"); // original preserved
  });

  // ── Truncated response triggers split-retry ───────────────────────────────

  it("splits batch in half when LLM response is truncated (finishReason=length)", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });

    let callCount = 0;
    mockLlmManager.chat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: batch of 2 → truncated
        return Promise.resolve({
          content: JSON.stringify({ results: [] }),
          totalTokens: 10,
          finishReason: "length",
        });
      }
      // Subsequent calls (split sub-batches of 1): succeed
      return Promise.resolve({
        content: JSON.stringify({ results: [{ pairIndex: 0, verdict: "YES" }] }),
        totalTokens: 10,
        finishReason: "stop",
      });
    });

    const pairs = [makePair(1, 101), makePair(2, 102)];
    const result = await service.analyzePairs(pairs, 1, "user-1", LARGE_TOKEN_BUDGET);

    // Original batch split → each sub-batch processed → both return YES → 2 semantic pairs
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.detectionMethod === "semantic")).toBe(true);
    // More than 1 chat call due to split
    expect(callCount).toBeGreaterThan(1);
  });

  // ── Timeout triggers split-in-half retry (RETRY-06) ──────────────────────

  it("splits batch in half and retries when LLM call times out (RETRY-06)", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });

    let callCount = 0;
    mockLlmManager.chat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: timeout error for the full batch
        const err = new Error("Request timeout");
        (err as any).code = "TIMEOUT";
        return Promise.reject(err);
      }
      // Subsequent calls (split sub-batches): succeed
      return Promise.resolve({
        content: JSON.stringify({ results: [{ pairIndex: 0, verdict: "YES" }] }),
        totalTokens: 50,
        finishReason: "stop",
      });
    });

    // 4 pairs all fit in one batch with large budget
    const pairs = makePairs(4);
    const result = await service.analyzePairs(pairs, 1, "user-1", LARGE_TOKEN_BUDGET);

    // First call timed out → split into 2 sub-batches → 2 more calls = 3 total
    expect(mockLlmManager.chat).toHaveBeenCalledTimes(3);
    expect(result.length).toBeGreaterThan(0);
  });

  // ── Parse failure on multi-pair batch triggers split-in-half retry ────────

  it("splits multi-pair batch and retries when LLM response JSON is unparseable (RETRY-06)", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });

    let callCount = 0;
    mockLlmManager.chat.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: broken JSON for the full batch
        return Promise.resolve({
          content: "not valid json {{{",
          totalTokens: 10,
          finishReason: "stop",
        });
      }
      // Subsequent calls (split sub-batches): succeed
      return Promise.resolve({
        content: JSON.stringify({ results: [{ pairIndex: 0, verdict: "YES" }] }),
        totalTokens: 50,
        finishReason: "stop",
      });
    });

    // 4 pairs all fit in one batch with large budget
    const pairs = makePairs(4);
    const result = await service.analyzePairs(pairs, 1, "user-1", LARGE_TOKEN_BUDGET);

    // First call parse failed → split → 2 retry calls = 3 total
    expect(mockLlmManager.chat).toHaveBeenCalledTimes(3);
    expect(result.length).toBeGreaterThan(0);
  });

  // ── Depth cap prevents infinite recursion (RETRY-06) ─────────────────────

  it("stops recursion and falls back to fuzzy when depth cap reached (RETRY-06)", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });

    // Always return truncated response — forces repeated splits
    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({ results: [] }),
      totalTokens: 10,
      finishReason: "length",
    });

    // 2 pairs: depth 0 → truncated → split to 1+1 at depth 1
    // Each single-pair call returns truncated but size=1 so no further split → fuzzy fallback
    const pairs = [makePair(1, 101), makePair(2, 102)];
    const result = await service.analyzePairs(pairs, 1, "user-1", LARGE_TOKEN_BUDGET);

    // 1 call for batch of 2, then 2 calls for single pairs = 3 total
    expect(mockLlmManager.chat).toHaveBeenCalledTimes(3);
    // All pairs fall back to fuzzy since single-pair batches can't split further
    expect(result).toHaveLength(2);
    for (const item of result) {
      expect(item.detectionMethod).toBe("fuzzy");
    }
  });

  // ── Undefined retryOptions passed through when not provided (RETRY-01) ────

  it("passes undefined retryOptions to manager.chat when not provided (RETRY-01)", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });
    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({ results: [{ pairIndex: 0, verdict: "YES" }] }),
      totalTokens: 50,
      finishReason: "stop",
    });

    const pairs = [makePair(1, 101)];
    await service.analyzePairs(pairs, 1, "user-1", LARGE_TOKEN_BUDGET);

    const chatCall = mockLlmManager.chat.mock.calls[0]!;
    expect(chatCall[2]).toBeUndefined();
  });
});
