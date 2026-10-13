import { describe, expect, it } from "vitest";
import {
  AI_SCORE_CAP,
  aiOutputSchema,
  aiSelectionSchema,
  mergeAiBatches,
  salvageTruncatedJson,
  toAiLayer,
  validateAiBatch,
  type AiBatchResult,
} from "./aiOutput";

const validIds = new Set([1, 2, 3]);
const changedPaths = new Set(["lib/auth.ts", "lib/session.ts", "README.md"]);

function validate(raw: string, extra: { finishReason?: string } = {}) {
  return validateAiBatch(raw, {
    validIds,
    changedPaths,
    batchIndex: 0,
    ...extra,
  });
}

function batch(overrides: Partial<AiBatchResult>): AiBatchResult {
  return {
    batchIndex: 0,
    selections: [],
    uncoveredFiles: [],
    summary: "",
    partial: false,
    droppedIds: [],
    ...overrides,
  };
}

describe("schemas", () => {
  it("accepts a well-formed selection and fills defaults", () => {
    const parsed = aiOutputSchema.parse({
      selections: [{ caseId: 1, score: 90, rationale: "covers login" }],
    });
    expect(parsed.uncoveredFiles).toEqual([]);
    expect(parsed.summary).toBe("");
    expect(parsed.selections[0].files).toBeUndefined();
  });

  it("rejects non-integer ids, out-of-range scores and long rationales", () => {
    expect(
      aiSelectionSchema.safeParse({ caseId: 1.5, score: 50, rationale: "r" })
        .success
    ).toBe(false);
    expect(
      aiSelectionSchema.safeParse({ caseId: 1, score: 101, rationale: "r" })
        .success
    ).toBe(false);
    expect(
      aiSelectionSchema.safeParse({ caseId: 1, score: -1, rationale: "r" })
        .success
    ).toBe(false);
    expect(
      aiSelectionSchema.safeParse({
        caseId: 1,
        score: 50,
        rationale: "x".repeat(401),
      }).success
    ).toBe(false);
    expect(aiOutputSchema.safeParse({}).success).toBe(false);
  });
});

describe("validateAiBatch", () => {
  it.each([undefined, null, ""])(
    "reports %p content as an empty answer instead of throwing",
    (raw) => {
      const out = validateAiBatch(raw as any, {
        validIds: new Set([1]),
        changedPaths: new Set(["src/a.ts"]),
        batchIndex: 0,
      });

      expect(out.parseError).toBe("empty response");
      expect(out.selections).toEqual([]);
      expect(out.partial).toBe(false);
    }
  );

  it("parses fenced output", () => {
    const result = validate(
      '```json\n{"selections":[{"caseId":1,"score":90,"rationale":"login","files":["lib/auth.ts"]}],"uncoveredFiles":["README.md"],"summary":"Auth change."}\n```'
    );
    expect(result.parseError).toBeUndefined();
    expect(result.partial).toBe(false);
    expect(result.selections).toEqual([
      { caseId: 1, score: 90, rationale: "login", files: ["lib/auth.ts"] },
    ]);
    expect(result.uncoveredFiles).toEqual(["README.md"]);
    expect(result.summary).toBe("Auth change.");
    expect(result.batchIndex).toBe(0);
  });

  it("drops hallucinated ids and reports them", () => {
    const result = validate(
      JSON.stringify({
        selections: [
          { caseId: 1, score: 80, rationale: "ok" },
          { caseId: 99, score: 95, rationale: "made up" },
          { caseId: 42, score: 60, rationale: "also made up" },
          { caseId: 99, score: 50, rationale: "again" },
        ],
      })
    );
    expect(result.selections.map((s) => s.caseId)).toEqual([1]);
    expect(result.droppedIds).toEqual([99, 42]);
  });

  it("dedupes repeated ids keeping the highest score", () => {
    const result = validate(
      JSON.stringify({
        selections: [
          { caseId: 2, score: 60, rationale: "low", files: ["lib/auth.ts"] },
          {
            caseId: 2,
            score: 85,
            rationale: "high",
            files: ["lib/session.ts"],
          },
          { caseId: 2, score: 70, rationale: "mid" },
        ],
      })
    );
    expect(result.selections).toEqual([
      { caseId: 2, score: 85, rationale: "high", files: ["lib/session.ts"] },
    ]);
  });

  it("filters files and uncoveredFiles to changed paths and dedupes them", () => {
    const result = validate(
      JSON.stringify({
        selections: [
          {
            caseId: 1,
            score: 90,
            rationale: "r",
            files: ["lib/auth.ts", "lib/nope.ts", "lib/auth.ts"],
          },
        ],
        uncoveredFiles: ["README.md", "lib/other.ts", "README.md"],
      })
    );
    expect(result.selections[0].files).toEqual(["lib/auth.ts"]);
    expect(result.uncoveredFiles).toEqual(["README.md"]);
  });

  it("truncates rationale to 200 characters", () => {
    const result = validate(
      JSON.stringify({
        selections: [{ caseId: 1, score: 90, rationale: "y".repeat(300) }],
      })
    );
    expect(result.selections[0].rationale).toHaveLength(200);
  });

  it("returns a parse error for prose without JSON", () => {
    const result = validate("I cannot help with that.");
    expect(result.selections).toEqual([]);
    expect(result.partial).toBe(false);
    expect(result.parseError).toBe("no JSON object in response");
  });

  it("returns a parse error for an empty body", () => {
    expect(validate("").parseError).toBe("empty response");
  });

  it("returns a schema error for a valid object of the wrong shape", () => {
    const result = validate('{"candidates":[]}');
    expect(result.selections).toEqual([]);
    expect(result.parseError).toContain("selections");
  });

  it("does not salvage truncated JSON unless the finish reason is length", () => {
    const truncated =
      '{"selections":[{"caseId":1,"score":90,"rationale":"a","files":["lib/auth.ts"]},{"caseId":2,"score":70,"rationale":"b"},{"caseId":3,"score":5';
    const result = validate(truncated);
    expect(result.selections).toEqual([]);
    expect(result.partial).toBe(false);
    expect(result.parseError).toBeTruthy();
  });

  it("salvages complete selection objects from truncated output", () => {
    const truncated =
      '{"selections":[{"caseId":1,"score":90,"rationale":"a","files":["lib/auth.ts","x.ts"]},{"caseId":99,"score":70,"rationale":"b"},{"caseId":2,"score":70,"rationale":"b"},{"caseId":3,"score":5';
    const result = validate(truncated, { finishReason: "length" });
    expect(result.partial).toBe(true);
    expect(result.parseError).toBeUndefined();
    expect(result.selections).toEqual([
      { caseId: 1, score: 90, rationale: "a", files: ["lib/auth.ts"] },
      { caseId: 2, score: 70, rationale: "b", files: [] },
    ]);
    expect(result.droppedIds).toEqual([99]);
    expect(result.uncoveredFiles).toEqual([]);
    expect(result.summary).toBe("");
  });

  it("marks a length-cut response with nothing recoverable as partial with an error", () => {
    const result = validate('{"selections":[{"caseId":1,"sco', {
      finishReason: "length",
    });
    expect(result.partial).toBe(true);
    expect(result.selections).toEqual([]);
    expect(result.parseError).toBeTruthy();
  });
});

describe("salvageTruncatedJson", () => {
  it("skips objects that fail the selection schema", () => {
    const out = salvageTruncatedJson(
      '{"selections":[{"caseId":"one","score":90,"rationale":"a"},{"caseId":2,"score":70,"rationale":"b"}'
    );
    expect(out).toEqual([{ caseId: 2, score: 70, rationale: "b" }]);
  });
});

describe("mergeAiBatches", () => {
  it("keeps the max score per case with its rationale, files and batch index", () => {
    const merged = mergeAiBatches([
      batch({
        batchIndex: 0,
        selections: [
          { caseId: 1, score: 60, rationale: "b0", files: ["lib/auth.ts"] },
          { caseId: 2, score: 90, rationale: "b0-2", files: [] },
        ],
      }),
      batch({
        batchIndex: 1,
        selections: [
          { caseId: 1, score: 88, rationale: "b1", files: ["lib/session.ts"] },
        ],
      }),
    ]);
    expect(merged.selections).toEqual([
      { caseId: 2, score: 90, rationale: "b0-2", files: [], batchIndex: 0 },
      {
        caseId: 1,
        score: 88,
        rationale: "b1",
        files: ["lib/session.ts"],
        batchIndex: 1,
      },
    ]);
  });

  it("intersects uncovered files across batches that mentioned files and removes covered ones", () => {
    const merged = mergeAiBatches([
      batch({
        batchIndex: 0,
        uncoveredFiles: ["README.md", "lib/session.ts", "lib/auth.ts"],
      }),
      batch({
        batchIndex: 1,
        selections: [
          { caseId: 1, score: 90, rationale: "r", files: ["lib/auth.ts"] },
        ],
        uncoveredFiles: ["README.md", "lib/session.ts"],
      }),
      batch({
        batchIndex: 2,
        selections: [
          { caseId: 2, score: 70, rationale: "r", files: ["lib/session.ts"] },
        ],
        uncoveredFiles: ["README.md"],
      }),
      batch({ batchIndex: 3, selections: [], uncoveredFiles: [] }),
    ]);
    expect(merged.uncoveredFiles).toEqual(["README.md"]);
  });

  it("returns no uncovered files when no batch mentioned any file", () => {
    const merged = mergeAiBatches([
      batch({
        selections: [{ caseId: 1, score: 50, rationale: "r", files: [] }],
      }),
      batch({ batchIndex: 1 }),
    ]);
    expect(merged.uncoveredFiles).toEqual([]);
  });

  it("uses the first non-empty summary", () => {
    const merged = mergeAiBatches([
      batch({ summary: "" }),
      batch({ batchIndex: 1, summary: "Second." }),
      batch({ batchIndex: 2, summary: "Third." }),
    ]);
    expect(merged.summary).toBe("Second.");
    expect(mergeAiBatches([]).summary).toBe("");
  });
});

describe("toAiLayer", () => {
  it("clamps scores at the AI cap and carries the batch index", () => {
    const layer = toAiLayer({
      selections: [
        {
          caseId: 1,
          score: 100,
          rationale: "direct",
          files: ["lib/auth.ts"],
          batchIndex: 2,
        },
        {
          caseId: 2,
          score: 42,
          rationale: "indirect",
          files: [],
          batchIndex: 0,
        },
      ],
      uncoveredFiles: [],
      summary: "",
    });
    expect(AI_SCORE_CAP).toBe(95);
    expect(layer.get(1)).toEqual({
      caseId: 1,
      score: 95,
      reasons: [
        {
          kind: "AI",
          rationale: "direct",
          score: 95,
          files: ["lib/auth.ts"],
          batchIndex: 2,
        },
      ],
    });
    expect(layer.get(2)).toEqual({
      caseId: 2,
      score: 42,
      reasons: [
        { kind: "AI", rationale: "indirect", score: 42, batchIndex: 0 },
      ],
    });
  });

  it("prefers an explicit batch index map", () => {
    const layer = toAiLayer(
      {
        selections: [
          { caseId: 1, score: 80, rationale: "r", files: [], batchIndex: 0 },
        ],
        uncoveredFiles: [],
        summary: "",
      },
      new Map([[1, 4]])
    );
    expect(layer.get(1)?.reasons[0]).toMatchObject({ batchIndex: 4 });
  });
});
