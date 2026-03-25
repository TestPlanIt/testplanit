import { beforeEach, describe, expect, it, vi } from "vitest";

import { LLM_FEATURES } from "~/lib/llm/constants";

import {
  BATCH_SIZE,
  DuplicateAnalysisService,
  MAX_PAIRS_PER_SCAN,
} from "./duplicate-analysis.service";
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

function _makeYesResponse(count: number): string {
  const results = Array.from({ length: count }, (_, i) => ({
    pairIndex: i,
    verdict: "YES",
  }));
  return JSON.stringify({ results });
}

function _makeNoResponse(count: number): string {
  const results = Array.from({ length: count }, (_, i) => ({
    pairIndex: i,
    verdict: "NO",
  }));
  return JSON.stringify({ results });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DuplicateAnalysisService", () => {
  let service: DuplicateAnalysisService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DuplicateAnalysisService(mockLlmManager, mockPromptResolver);
  });

  // ── Test 1: Empty pairs array ─────────────────────────────────────────────

  it("returns empty array when given no pairs", async () => {
    const result = await service.analyzePairs([], 1, "user-1");
    expect(result).toEqual([]);
    expect(mockLlmManager.resolveIntegration).not.toHaveBeenCalled();
  });

  // ── Test 2: No LLM configured ─────────────────────────────────────────────

  it("returns all input pairs unchanged with detectionMethod 'fuzzy' when no LLM is configured", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue(null);

    const pairs = makePairs(3);
    const result = await service.analyzePairs(pairs, 1, "user-1");

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
    const result = await service.analyzePairs(pairs, 1, "user-1");

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

  // ── Test 4: Pairs capped at MAX_PAIRS_PER_SCAN ────────────────────────────

  it("caps analysis at MAX_PAIRS_PER_SCAN and returns overflow pairs as fuzzy unchanged", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });

    // Return YES for all analyzed pairs
    mockLlmManager.chat.mockImplementation((_id: number, req: any) => {
      const userContent: string = req.messages[1].content;
      // Count pair lines in user prompt to determine batch size
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

    const pairs = makePairs(60); // 60 > MAX_PAIRS_PER_SCAN (50)
    const result = await service.analyzePairs(pairs, 1, "user-1");

    // First 50 analyzed → all YES → all kept with semantic
    // Last 10 overflow → returned as fuzzy
    expect(result).toHaveLength(60);

    const semanticPairs = result.filter((r) => r.detectionMethod === "semantic");
    const fuzzyPairs = result.filter((r) => r.detectionMethod === "fuzzy");

    expect(semanticPairs).toHaveLength(50);
    expect(fuzzyPairs).toHaveLength(10);

    // Overflow pairs have original confidence
    for (const fp of fuzzyPairs) {
      expect(fp.confidence).toBe("MEDIUM");
    }
  });

  // ── Test 5: Batch size — 25 pairs → 3 LLM calls ─────────────────────────

  it("sends 25 pairs in 3 batches (10, 10, 5)", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });
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

    const pairs = makePairs(25);
    await service.analyzePairs(pairs, 1, "user-1");

    expect(mockLlmManager.chat).toHaveBeenCalledTimes(3);
  });

  // ── Test 6: LLM error for one batch — keep that batch as fuzzy ────────────

  it("keeps batch pairs as fuzzy when LLM call throws an error for that batch", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });

    let callCount = 0;
    mockLlmManager.chat.mockImplementation((_id: number, req: any) => {
      callCount++;
      if (callCount === 1) {
        // First batch (10 pairs) succeeds with YES
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
      // Second batch throws
      return Promise.reject(new Error("LLM timeout"));
    });

    const pairs = makePairs(15); // 2 batches: 10 + 5
    const result = await service.analyzePairs(pairs, 1, "user-1");

    // 10 from first batch (YES → semantic HIGH) + 5 from second batch (error → fuzzy)
    expect(result).toHaveLength(15);

    const semanticPairs = result.filter((r) => r.detectionMethod === "semantic");
    const fuzzyPairs = result.filter((r) => r.detectionMethod === "fuzzy");

    expect(semanticPairs).toHaveLength(10);
    expect(fuzzyPairs).toHaveLength(5);
  });

  // ── Test 7: Unparseable JSON → keep batch as fuzzy ───────────────────────

  it("keeps batch pairs as fuzzy when LLM returns unparseable JSON", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 42 });
    mockLlmManager.chat.mockResolvedValue({
      content: "This is not valid JSON { broken",
      totalTokens: 10,
    });

    const pairs = makePairs(5);
    const result = await service.analyzePairs(pairs, 1, "user-1");

    expect(result).toHaveLength(5);
    for (const item of result) {
      expect(item.detectionMethod).toBe("fuzzy");
    }
  });

  // ── Constants check ───────────────────────────────────────────────────────

  it("exports BATCH_SIZE = 10 and MAX_PAIRS_PER_SCAN = 50", () => {
    expect(BATCH_SIZE).toBe(10);
    expect(MAX_PAIRS_PER_SCAN).toBe(50);
  });

  // ── LLM call params validation ────────────────────────────────────────────

  it("calls LLM with correct parameters including feature and low temperature", async () => {
    mockLlmManager.resolveIntegration.mockResolvedValue({ integrationId: 99 });
    mockLlmManager.chat.mockResolvedValue({
      content: JSON.stringify({ results: [{ pairIndex: 0, verdict: "YES" }] }),
      totalTokens: 50,
    });

    const pairs = [makePair(1, 101)];
    await service.analyzePairs(pairs, 5, "user-xyz");

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
    const result = await service.analyzePairs(pairs, 1, "user-1");

    // Pair 0 YES → semantic HIGH; pair 1 missing → fuzzy
    expect(result).toHaveLength(2);
    const semantic = result.find((r) => r.caseAId === 1)!;
    const fuzzy = result.find((r) => r.caseAId === 2)!;

    expect(semantic.detectionMethod).toBe("semantic");
    expect(semantic.confidence).toBe("HIGH");
    expect(fuzzy.detectionMethod).toBe("fuzzy");
    expect(fuzzy.confidence).toBe("MEDIUM"); // original preserved
  });
});
