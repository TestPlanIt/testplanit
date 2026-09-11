import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LlmResponse } from "~/lib/llm/types/index";
import type { CompressedCase } from "../promptBuilder";
import {
  runAiLayer,
  type AiLayerDeps,
  type AiLayerInput,
  type AiLayerLlm,
} from "./aiLayer";

/** Output cut off mid-object: nothing complete enough to salvage. */
const CUT_OFF = '{"selections":[{"caseId":1,"score":90,"rationale":"tru';

function response(overrides: Partial<LlmResponse> = {}): LlmResponse {
  return {
    content: JSON.stringify({
      selections: [],
      uncoveredFiles: [],
      summary: "",
    }),
    model: "fake-model",
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    ...overrides,
  };
}

function selectionsFor(ids: number[]) {
  return JSON.stringify({
    selections: ids.map((id) => ({
      caseId: id,
      score: 80,
      rationale: `case ${id}`,
    })),
    uncoveredFiles: [],
    summary: "Auth change.",
  });
}

function candidates(count: number): CompressedCase[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Case ${i + 1}`,
  }));
}

type CancelCheck = () => Promise<boolean>;

let chat: ReturnType<typeof vi.fn>;
let isCancelled: ReturnType<typeof vi.fn<CancelCheck>>;

function makeDeps(overrides: Partial<AiLayerDeps> = {}): AiLayerDeps {
  return {
    llm: { chat } as unknown as AiLayerLlm,
    feature: "impact-analysis",
    isCancelled,
    ...overrides,
  };
}

function makeInput(overrides: Partial<AiLayerInput> = {}): AiLayerInput {
  return {
    integrationId: 7,
    systemPrompt: "Rank the cases.",
    userTemplate: "{{CANDIDATE_CASES}}",
    temperature: 0,
    maxOutputTokens: 1000,
    // Large enough that the item-count cap, not the token budget, decides.
    maxTokensPerRequest: 1_000_000,
    userId: "user-1",
    projectId: 374,
    analysisId: 900,
    baseSha: "aaaaaaa",
    headSha: "bbbbbbb",
    diffText: "diff --git a/lib/auth.ts b/lib/auth.ts",
    changedFileCount: 1,
    excludedCount: 0,
    changedPaths: ["lib/auth.ts"],
    pinnedCaseIds: [],
    candidates: candidates(4),
    cfg: { thinkingBudget: 0 },
    ...overrides,
  };
}

/** How many candidates each LLM call actually carried. */
function batchSizes(): number[] {
  return chat.mock.calls.map(
    ([, request]) =>
      (request.metadata as { candidateCount: number }).candidateCount
  );
}

describe("runAiLayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    chat = vi.fn().mockResolvedValue(response());
    isCancelled = vi.fn<CancelCheck>().mockResolvedValue(false);
  });

  describe("batch sizing", () => {
    it("floors the batch at 20 cases when the output budget is tiny", async () => {
      // (1000 - 500 reserve) / 60 per case = 8, below the floor.
      await runAiLayer(
        makeDeps(),
        makeInput({ maxOutputTokens: 1000, candidates: candidates(45) })
      );

      expect(batchSizes()).toEqual([20, 20, 5]);
    });

    it("caps the batch at 200 cases however large the output budget", async () => {
      await runAiLayer(
        makeDeps(),
        makeInput({ maxOutputTokens: 100_000, candidates: candidates(250) })
      );

      expect(batchSizes()).toEqual([200, 50]);
    });

    it("sizes the batch from the output budget in between", async () => {
      // (3500 - 500) / 60 = 50 cases.
      await runAiLayer(
        makeDeps(),
        makeInput({ maxOutputTokens: 3500, candidates: candidates(60) })
      );

      expect(batchSizes()).toEqual([50, 10]);
    });

    it("splits on the token budget when it is tighter than the item cap", async () => {
      await runAiLayer(
        makeDeps(),
        makeInput({ maxTokensPerRequest: 40, candidates: candidates(6) })
      );

      expect(batchSizes().every((size) => size < 6)).toBe(true);
      expect(batchSizes().reduce((a, b) => a + b, 0)).toBe(6);
    });
  });

  describe("cut-off batches", () => {
    it("splits a batch the model cut off before it chose anything", async () => {
      chat.mockResolvedValue(
        response({ content: CUT_OFF, finishReason: "length" })
      );

      const out = await runAiLayer(makeDeps(), makeInput());

      // One full batch, then its two halves — and no further splitting, even
      // though the halves came back cut off too.
      expect(batchSizes()).toEqual([4, 2, 2]);
      expect(out.stats.truncatedBatches).toEqual([0, 0, 0]);
      expect(out.warnings.map((w) => w.code)).toContain("ai_truncated");
    });

    it("keeps what the halves returned", async () => {
      chat
        .mockResolvedValueOnce(
          response({ content: CUT_OFF, finishReason: "length" })
        )
        .mockResolvedValueOnce(response({ content: selectionsFor([1, 2]) }))
        .mockResolvedValueOnce(response({ content: selectionsFor([3, 4]) }));

      const out = await runAiLayer(makeDeps(), makeInput());

      expect([...out.layer.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
      expect(out.summary).toBe("Auth change.");
    });

    it("does not split a batch it cannot split", async () => {
      chat.mockResolvedValue(
        response({ content: CUT_OFF, finishReason: "length" })
      );

      const out = await runAiLayer(
        makeDeps(),
        makeInput({ candidates: candidates(1) })
      );

      expect(chat).toHaveBeenCalledTimes(1);
      expect(out.layer.size).toBe(0);
    });

    it("does not split a cut-off batch that still chose cases", async () => {
      chat.mockResolvedValue(
        response({ content: selectionsFor([1]), finishReason: "length" })
      );

      const out = await runAiLayer(makeDeps(), makeInput());

      expect(chat).toHaveBeenCalledTimes(1);
      expect(out.warnings.map((w) => w.code)).toContain("ai_truncated");
      expect([...out.layer.keys()]).toEqual([1]);
    });

    it("stops calling the model when the job is cancelled between halves", async () => {
      chat.mockResolvedValue(
        response({ content: CUT_OFF, finishReason: "length" })
      );
      isCancelled
        .mockResolvedValueOnce(false) // before the batch
        .mockResolvedValueOnce(false) // before the first half
        .mockResolvedValue(true); // before the second half

      await runAiLayer(makeDeps(), makeInput());

      expect(batchSizes()).toEqual([4, 2]);
    });
  });

  describe("warnings and stats", () => {
    it("reports a batch that failed outright as partial", async () => {
      chat
        .mockRejectedValueOnce(new Error("provider exploded"))
        .mockResolvedValue(response({ content: selectionsFor([21]) }));

      const out = await runAiLayer(
        makeDeps(),
        makeInput({ maxOutputTokens: 1000, candidates: candidates(40) })
      );

      expect(out.stats.failedBatchCount).toBe(1);
      expect(out.stats.batchCount).toBe(2);
      expect(out.warnings).toContainEqual({
        code: "ai_partial",
        detail: { failedBatchCount: 1, errors: ["provider exploded"] },
      });
      expect([...out.layer.keys()]).toEqual([21]);
    });

    it("reports unparseable output as partial", async () => {
      chat.mockResolvedValue(response({ content: "I cannot help with that." }));

      const out = await runAiLayer(makeDeps(), makeInput());

      expect(out.warnings.map((w) => w.code)).toEqual(["ai_partial"]);
      expect(out.stats.failedBatchCount).toBe(0);
    });

    it("warns about nothing when every batch came back clean", async () => {
      chat.mockResolvedValue(response({ content: selectionsFor([1]) }));

      const out = await runAiLayer(makeDeps(), makeInput());

      expect(out.warnings).toEqual([]);
      expect(out.stats.truncatedBatches).toEqual([]);
      expect(out.cancelled).toBe(false);
    });

    it("sums token usage across every call, retries included", async () => {
      chat.mockResolvedValue(
        response({
          content: CUT_OFF,
          finishReason: "length",
          model: "claude-test",
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
        })
      );

      const out = await runAiLayer(makeDeps(), makeInput());

      expect(chat).toHaveBeenCalledTimes(3);
      expect(out.stats.tokens).toEqual({
        prompt: 300,
        completion: 60,
        total: 360,
      });
      expect(out.stats.model).toBe("claude-test");
    });
  });
});
