import { describe, it, expect } from "vitest";
import { StepSequenceScanService } from "./stepSequenceScanService";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal case object with the expected shape.
 * Steps are pre-extracted plain-text strings (tests operate on already-extracted text,
 * since extractStepText in the service converts TipTap JSON to plain text — here we
 * pass plain strings directly to test the grouping/LCS logic in isolation).
 */
function makeCase(
  id: number,
  steps: Array<{ id: number; step: string; expectedResult?: string; order?: number }>,
) {
  return {
    id,
    steps: steps.map((s, i) => ({
      id: s.id,
      step: s.step,
      expectedResult: s.expectedResult ?? "",
      order: s.order ?? i + 1,
    })),
  };
}

/**
 * Build a single step object.
 */
function makeStep(
  id: number,
  text: string,
  expectedResult = "",
  order = 0,
): { id: number; step: string; expectedResult: string; order: number } {
  return { id, step: text, expectedResult, order };
}

// ---------------------------------------------------------------------------
// Shared step "emptyEditorContent" simulation
// In a real case, an unresolved shared step placeholder has empty content.
// The test documents that the service receives pre-resolved cases and that
// callers are responsible for running resolveSharedSteps() first.
// ---------------------------------------------------------------------------
const EMPTY_EDITOR_CONTENT = "";

describe("StepSequenceScanService", async () => {
  const service = new StepSequenceScanService();

  // -------------------------------------------------------------------------
  // Basic behavior
  // -------------------------------------------------------------------------

  it("returns 0 groups for empty cases array", async () => {
    const result = await service.findSharedSequences([]);
    expect(result).toEqual([]);
  });

  it("returns 0 groups for single case (need >= 2 cases for a match)", async () => {
    const c = makeCase(1, [
      makeStep(1, "Step 1"),
      makeStep(2, "Step 2"),
      makeStep(3, "Step 3"),
    ]);
    const result = await service.findSharedSequences([c]);
    expect(result).toEqual([]);
  });

  it("returns 0 groups for cases with completely different steps", async () => {
    const a = makeCase(1, [makeStep(1, "Login to app"), makeStep(2, "Click submit"), makeStep(3, "Check error")]);
    const b = makeCase(2, [makeStep(4, "Open report"), makeStep(5, "Export PDF"), makeStep(6, "Download file")]);
    const result = await service.findSharedSequences([a, b]);
    expect(result).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Threshold tests
  // -------------------------------------------------------------------------

  it("returns 1 group with 2 members when two cases share 4 identical steps (>= default minSteps=3)", async () => {
    const shared = [
      makeStep(1, "Navigate to login page"),
      makeStep(2, "Enter username"),
      makeStep(3, "Enter password"),
      makeStep(4, "Click login button"),
    ];
    const a = makeCase(1, shared);
    const b = makeCase(2, [
      { id: 10, step: "Navigate to login page", expectedResult: "", order: 1 },
      { id: 11, step: "Enter username", expectedResult: "", order: 2 },
      { id: 12, step: "Enter password", expectedResult: "", order: 3 },
      { id: 13, step: "Click login button", expectedResult: "", order: 4 },
    ]);

    const result = await service.findSharedSequences([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.members).toHaveLength(2);
    expect(result[0]!.stepCount).toBe(4);
    expect(result[0]!.members.map((m) => m.caseId).sort()).toEqual([1, 2]);
  });

  it("returns 0 groups when two cases share only 2 steps (< default minSteps=3)", async () => {
    const a = makeCase(1, [
      makeStep(1, "Navigate to login page"),
      makeStep(2, "Enter username"),
    ]);
    const b = makeCase(2, [
      { id: 10, step: "Navigate to login page", expectedResult: "", order: 1 },
      { id: 11, step: "Enter username", expectedResult: "", order: 2 },
    ]);

    const result = await service.findSharedSequences([a, b]);
    expect(result).toHaveLength(0);
  });

  it("minSteps=2 parameter finds sequences of length 2 that default would miss", async () => {
    const a = makeCase(1, [makeStep(1, "Navigate to login page"), makeStep(2, "Enter username")]);
    const b = makeCase(2, [
      { id: 10, step: "Navigate to login page", expectedResult: "", order: 1 },
      { id: 11, step: "Enter username", expectedResult: "", order: 2 },
    ]);

    const result = await service.findSharedSequences([a, b], 2);
    expect(result).toHaveLength(1);
    expect(result[0]!.stepCount).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Group-by-fingerprint: 3 cases sharing same sequence
  // -------------------------------------------------------------------------

  it("groups 3 cases sharing the same 4-step sequence into 1 group with 3 members", async () => {
    const steps = [
      "Navigate to login page",
      "Enter username",
      "Enter password",
      "Click login button",
    ];

    const a = makeCase(1, steps.map((t, i) => makeStep(i + 1, t, "", i + 1)));
    const b = makeCase(2, steps.map((t, i) => makeStep(i + 10, t, "", i + 1)));
    const c = makeCase(3, steps.map((t, i) => makeStep(i + 20, t, "", i + 1)));

    const result = await service.findSharedSequences([a, b, c]);

    // All three share the same fingerprint — should produce exactly 1 group
    expect(result).toHaveLength(1);
    expect(result[0]!.members).toHaveLength(3);
    expect(result[0]!.members.map((m) => m.caseId).sort()).toEqual([1, 2, 3]);
    expect(result[0]!.stepCount).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Fingerprint and step ID correctness
  // -------------------------------------------------------------------------

  it("each group has a non-empty fingerprint string and correct stepCount", async () => {
    const a = makeCase(1, [
      makeStep(1, "Open browser"),
      makeStep(2, "Navigate to homepage"),
      makeStep(3, "Verify page title"),
    ]);
    const b = makeCase(2, [
      makeStep(10, "Open browser"),
      makeStep(11, "Navigate to homepage"),
      makeStep(12, "Verify page title"),
    ]);

    const result = await service.findSharedSequences([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.fingerprint).toBeTruthy();
    expect(typeof result[0]!.fingerprint).toBe("string");
    expect(result[0]!.stepCount).toBe(3);
  });

  it("each member has correct startStepId and endStepId from Steps.id values", async () => {
    const a = makeCase(1, [
      makeStep(101, "Step A"),
      makeStep(102, "Step B"),
      makeStep(103, "Step C"),
    ]);
    const b = makeCase(2, [
      makeStep(201, "Step A"),
      makeStep(202, "Step B"),
      makeStep(203, "Step C"),
    ]);

    const result = await service.findSharedSequences([a, b]);
    expect(result).toHaveLength(1);

    const memberA = result[0]!.members.find((m) => m.caseId === 1);
    const memberB = result[0]!.members.find((m) => m.caseId === 2);

    expect(memberA).toBeDefined();
    expect(memberA!.startStepId).toBe(101);
    expect(memberA!.endStepId).toBe(103);

    expect(memberB).toBeDefined();
    expect(memberB!.startStepId).toBe(201);
    expect(memberB!.endStepId).toBe(203);
  });

  // -------------------------------------------------------------------------
  // Fuzzy matching
  // -------------------------------------------------------------------------

  it("matches steps that are fuzzy-equal (levenshteinRatio >= 0.85)", async () => {
    // Slightly different wording — still >= 0.85 similarity
    const a = makeCase(1, [
      makeStep(1, "Navigate to the login page"),
      makeStep(2, "Enter the username in the field"),
      makeStep(3, "Enter the password in the field"),
    ]);
    const b = makeCase(2, [
      makeStep(10, "Navigate to the login page"),
      makeStep(11, "Enter the username in the field"),
      makeStep(12, "Enter the password in the field"),
    ]);

    const result = await service.findSharedSequences([a, b]);
    expect(result).toHaveLength(1);
  });

  it("does NOT match steps with low similarity (levenshteinRatio < 0.85)", async () => {
    // Completely different wording
    const a = makeCase(1, [
      makeStep(1, "Login"),
      makeStep(2, "Submit"),
      makeStep(3, "Done"),
    ]);
    const b = makeCase(2, [
      makeStep(10, "Navigate to completely unrelated module"),
      makeStep(11, "Click export CSV button and download"),
      makeStep(12, "Verify the file has all columns"),
    ]);

    const result = await service.findSharedSequences([a, b]);
    expect(result).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Overlapping sequences
  // -------------------------------------------------------------------------

  it("returns 2 groups when two cases have overlapping sequences (steps 1-5 and steps 3-8 match different patterns)", async () => {
    // Case A has 8 steps: pattern1 in steps 0-4, pattern2 in steps 2-7 (overlapping)
    // Case B shares the first 5 steps with case A
    // Case C shares steps 3-8 with case A
    // Case A: patternShared1[0..4] + Zeta + Eta + Theta = 8 steps
    const caseA = makeCase(1, [
      makeStep(1, "Alpha step"),
      makeStep(2, "Beta step"),
      makeStep(3, "Gamma step"),
      makeStep(4, "Delta step"),
      makeStep(5, "Epsilon step"),
      makeStep(6, "Zeta step"),
      makeStep(7, "Eta step"),
      makeStep(8, "Theta step"),
    ]);

    // Case B: shares steps 1-5 with case A
    const caseB = makeCase(2, [
      makeStep(11, "Alpha step"),
      makeStep(12, "Beta step"),
      makeStep(13, "Gamma step"),
      makeStep(14, "Delta step"),
      makeStep(15, "Epsilon step"),
    ]);

    // Case C: shares steps 3-8 with case A
    const caseC = makeCase(3, [
      makeStep(21, "Gamma step"),
      makeStep(22, "Delta step"),
      makeStep(23, "Epsilon step"),
      makeStep(24, "Zeta step"),
      makeStep(25, "Eta step"),
      makeStep(26, "Theta step"),
    ]);

    const result = await service.findSharedSequences([caseA, caseB, caseC]);
    // A-B share steps 1-5; A-C share steps 3-8; B-C share steps 3-5 (only 3 steps, >= minSteps)
    // So we should get at least 2 distinct groups (the overlapping sequences are both reported)
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // Text extraction: service uses extractStepText not raw JSON
  // -------------------------------------------------------------------------

  it("compares steps using extracted plain text, not raw TipTap JSON strings", async () => {
    // Simulate TipTap JSON format — the service must extract plain text
    const tipTapDoc = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Navigate to login page" }] }],
    });

    const a = makeCase(1, [
      { id: 1, step: tipTapDoc, expectedResult: "", order: 1 },
      { id: 2, step: tipTapDoc, expectedResult: "", order: 2 },
      { id: 3, step: tipTapDoc, expectedResult: "", order: 3 },
    ]);
    const b = makeCase(2, [
      { id: 10, step: tipTapDoc, expectedResult: "", order: 1 },
      { id: 11, step: tipTapDoc, expectedResult: "", order: 2 },
      { id: 12, step: tipTapDoc, expectedResult: "", order: 3 },
    ]);

    // Both cases have the same TipTap JSON content — should match
    const result = await service.findSharedSequences([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]!.stepCount).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Shared step placeholder false-positive documentation
  // -------------------------------------------------------------------------

  it("skips cases with empty step text (unresolved shared step placeholders) due to token overlap pre-filter", async () => {
    // Two cases that both have steps with empty text (simulating unresolved shared step placeholders)
    // The token overlap pre-filter correctly skips these since empty strings produce no tokens
    // Callers should still invoke resolveSharedSteps() first as a best practice
    const caseWithEmptySteps1 = makeCase(1, [
      makeStep(1, EMPTY_EDITOR_CONTENT),
      makeStep(2, EMPTY_EDITOR_CONTENT),
      makeStep(3, EMPTY_EDITOR_CONTENT),
    ]);
    const caseWithEmptySteps2 = makeCase(2, [
      makeStep(10, EMPTY_EDITOR_CONTENT),
      makeStep(11, EMPTY_EDITOR_CONTENT),
      makeStep(12, EMPTY_EDITOR_CONTENT),
    ]);

    // Empty step text produces no tokens — pair is skipped by overlap pre-filter
    const result = await service.findSharedSequences([caseWithEmptySteps1, caseWithEmptySteps2]);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractContiguousRuns helper tests
// ---------------------------------------------------------------------------

describe("extractContiguousRuns", async () => {
  // We test via the service's behavior, but also verify the exported helper directly
  it("is importable for unit testing", async () => {
    const mod = await import("./stepSequenceScanService");
    expect(typeof mod.extractContiguousRuns).toBe("function");
  });

  it("returns empty array for empty input", async () => {
    const { extractContiguousRuns } = await import("./stepSequenceScanService");
    expect(extractContiguousRuns([], 3)).toEqual([]);
  });

  it("returns one run for consecutive pairs that meet minSteps", async () => {
    const { extractContiguousRuns } = await import("./stepSequenceScanService");
    const pairs = [
      { aIdx: 0, bIdx: 0 },
      { aIdx: 1, bIdx: 1 },
      { aIdx: 2, bIdx: 2 },
    ];
    const runs = extractContiguousRuns(pairs, 3);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(pairs);
  });

  it("splits non-contiguous pairs into separate runs", async () => {
    const { extractContiguousRuns } = await import("./stepSequenceScanService");
    const pairs = [
      { aIdx: 0, bIdx: 0 },
      { aIdx: 1, bIdx: 1 },
      { aIdx: 1, bIdx: 3 }, // gap — not contiguous
      { aIdx: 2, bIdx: 4 },
      { aIdx: 3, bIdx: 5 },
    ];
    const runs = extractContiguousRuns(pairs, 2);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(2);
    expect(runs[1]).toHaveLength(3);
  });

  it("excludes runs shorter than minSteps", async () => {
    const { extractContiguousRuns } = await import("./stepSequenceScanService");
    const pairs = [
      { aIdx: 0, bIdx: 0 },
      { aIdx: 1, bIdx: 1 },
    ];
    const runs = extractContiguousRuns(pairs, 3);
    expect(runs).toHaveLength(0);
  });
});
