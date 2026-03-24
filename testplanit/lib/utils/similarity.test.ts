import { describe, it, expect } from "vitest";
import {
  jaroWinkler,
  levenshteinRatio,
  jaccardSimilarity,
  combineScores,
  scoreToConfidence,
  FIELD_WEIGHTS,
  lcs,
  stepsEqual,
} from "~/lib/utils/similarity";

describe("jaroWinkler", () => {
  it("returns 1.0 for two empty strings", () => {
    expect(jaroWinkler("", "")).toBe(1.0);
  });

  it("returns 1.0 for identical strings", () => {
    expect(jaroWinkler("Login Happy Path", "Login Happy Path")).toBe(1.0);
  });

  it("returns >= 0.85 for very similar strings", () => {
    expect(jaroWinkler("Login Happy Path", "Login Happy Path v2")).toBeGreaterThanOrEqual(0.85);
  });

  it("returns < 0.85 but > 0.0 for partially similar strings", () => {
    const score = jaroWinkler("Login", "Logout");
    expect(score).toBeLessThan(0.85);
    expect(score).toBeGreaterThan(0.0);
  });

  it("returns close to 0.0 for completely different strings", () => {
    expect(jaroWinkler("abc", "xyz")).toBeLessThan(0.4);
  });

  it("is case insensitive", () => {
    expect(jaroWinkler("HELLO", "hello")).toBe(1.0);
    expect(jaroWinkler("Login Happy Path", "login happy path")).toBe(1.0);
  });

  it("returns 0.0 if one string is empty and the other is not", () => {
    expect(jaroWinkler("abc", "")).toBe(0.0);
    expect(jaroWinkler("", "abc")).toBe(0.0);
  });
});

describe("levenshteinRatio", () => {
  it("returns 1.0 for identical strings", () => {
    expect(levenshteinRatio("Login Happy Path", "Login Happy Path")).toBe(1.0);
  });

  it("returns 1.0 for two empty strings", () => {
    expect(levenshteinRatio("", "")).toBe(1.0);
  });

  it("is case insensitive", () => {
    expect(levenshteinRatio("LOGIN TEST", "login test")).toBe(1.0);
  });

  it("scores lower than Jaro-Winkler for strings differing by a few words", () => {
    // "login" vs "logout" = 2 edits in a ~25 char string
    const lev = levenshteinRatio("Verify user can login successfully", "Verify user can logout successfully");
    const jw = jaroWinkler("Verify user can login successfully", "Verify user can logout successfully");
    expect(lev).toBeLessThan(jw);
    expect(lev).toBeLessThan(0.95);
  });

  it("returns 0.0 if one string is empty and the other is not", () => {
    expect(levenshteinRatio("abc", "")).toBe(0.0);
    expect(levenshteinRatio("", "abc")).toBe(0.0);
  });

  it("returns low score for completely different strings", () => {
    expect(levenshteinRatio("Login test", "Password reset")).toBeLessThan(0.4);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 0.5 for sets with 2 intersection and 4 union", () => {
    expect(jaccardSimilarity(["a", "b", "c"], ["b", "c", "d"])).toBe(0.5);
  });

  it("returns 1.0 for two empty arrays", () => {
    expect(jaccardSimilarity([], [])).toBe(1.0);
  });

  it("returns 0.0 when one array is empty and the other is not", () => {
    expect(jaccardSimilarity(["a"], [])).toBe(0.0);
    expect(jaccardSimilarity([], ["a"])).toBe(0.0);
  });

  it("returns 1.0 for identical arrays", () => {
    expect(jaccardSimilarity(["a", "b", "c"], ["a", "b", "c"])).toBe(1.0);
  });

  it("returns 0.0 for completely disjoint arrays", () => {
    expect(jaccardSimilarity(["a", "b"], ["c", "d"])).toBe(0.0);
  });
});

describe("combineScores", () => {
  it("returns 1.0 when all signals are 1.0", () => {
    expect(combineScores({ name: 1.0, steps: 1.0, tags: 1.0, fields: 1.0 })).toBe(1.0);
  });

  it("returns 0 when all signals are 0", () => {
    expect(combineScores({ name: 0, steps: 0, tags: 0, fields: 0 })).toBe(0);
  });

  it("computes weighted average correctly", () => {
    // 0.8*0.5 + 0.6*0.3 + 0.4*0.1 + 0.2*0.1 = 0.40 + 0.18 + 0.04 + 0.02 = 0.64
    expect(combineScores({ name: 0.8, steps: 0.6, tags: 0.4, fields: 0.2 })).toBeCloseTo(0.64);
  });

  it("weights name signal at 0.5", () => {
    expect(combineScores({ name: 1.0, steps: 0, tags: 0, fields: 0 })).toBeCloseTo(0.5);
  });

  it("weights steps signal at 0.3", () => {
    expect(combineScores({ name: 0, steps: 1.0, tags: 0, fields: 0 })).toBeCloseTo(0.3);
  });
});

describe("scoreToConfidence", () => {
  it("returns HIGH for score >= 0.90", () => {
    expect(scoreToConfidence(0.95)).toBe("HIGH");
    expect(scoreToConfidence(0.90)).toBe("HIGH");
  });

  it("returns MEDIUM for score >= 0.80 and < 0.90", () => {
    expect(scoreToConfidence(0.85)).toBe("MEDIUM");
    expect(scoreToConfidence(0.80)).toBe("MEDIUM");
  });

  it("returns LOW for score >= 0.70 and < 0.80", () => {
    expect(scoreToConfidence(0.75)).toBe("LOW");
    expect(scoreToConfidence(0.70)).toBe("LOW");
  });

  it("returns null for score < 0.70", () => {
    expect(scoreToConfidence(0.65)).toBeNull();
    expect(scoreToConfidence(0.0)).toBeNull();
  });
});

describe("FIELD_WEIGHTS", () => {
  it("values sum to 1.0", () => {
    const sum = Object.values(FIELD_WEIGHTS).reduce((acc, val) => acc + val, 0);
    expect(sum).toBeCloseTo(1.0);
  });

  it("has name weight of 0.5", () => {
    expect(FIELD_WEIGHTS.name).toBe(0.5);
  });

  it("has steps weight of 0.3", () => {
    expect(FIELD_WEIGHTS.steps).toBe(0.3);
  });

  it("has tags weight of 0.1", () => {
    expect(FIELD_WEIGHTS.tags).toBe(0.1);
  });

  it("has fields weight of 0.1", () => {
    expect(FIELD_WEIGHTS.fields).toBe(0.1);
  });
});

describe("stepsEqual", () => {
  it("returns true for identical step texts with empty expectedResult", () => {
    expect(
      stepsEqual(
        { step: "Click the login button", expectedResult: "" },
        { step: "Click the login button", expectedResult: "" },
      ),
    ).toBe(true);
  });

  it("returns true for identical steps with matching expectedResult", () => {
    expect(
      stepsEqual(
        { step: "Click login", expectedResult: "Page loads" },
        { step: "Click login", expectedResult: "Page loads" },
      ),
    ).toBe(true);
  });

  it("returns true using step text only when one expectedResult is empty", () => {
    // One side has empty ER, other has text — asymmetric rule: compare step text only
    expect(
      stepsEqual(
        { step: "Click the login button", expectedResult: "" },
        { step: "Click the login button", expectedResult: "Dashboard visible" },
      ),
    ).toBe(true);
  });

  it("returns false when average of step and expectedResult similarity is below threshold", () => {
    // step texts identical (ratio 1.0), expectedResults completely different (~0.0)
    // average ~0.5, below 0.85
    expect(
      stepsEqual(
        { step: "Click login", expectedResult: "Page loads" },
        { step: "Click login", expectedResult: "Error shown" },
      ),
    ).toBe(false);
  });

  it("returns false for completely different step texts", () => {
    expect(
      stepsEqual(
        { step: "abc", expectedResult: "" },
        { step: "xyz", expectedResult: "" },
      ),
    ).toBe(false);
  });

  it("respects custom threshold parameter", () => {
    // levenshteinRatio("abcdef", "abcxyz") = 1 - 3/6 = 0.5 which fails at 0.85 but passes at 0.5
    expect(
      stepsEqual(
        { step: "abcdef", expectedResult: "" },
        { step: "abcxyz", expectedResult: "" },
        0.5,
      ),
    ).toBe(true);
    expect(
      stepsEqual(
        { step: "abcdef", expectedResult: "" },
        { step: "abcxyz", expectedResult: "" },
        0.85,
      ),
    ).toBe(false);
  });

  it("treats whitespace-only expectedResult as empty", () => {
    // "   " trims to "" — should use step text only
    expect(
      stepsEqual(
        { step: "Click the login button", expectedResult: "   " },
        { step: "Click the login button", expectedResult: "Dashboard visible" },
      ),
    ).toBe(true);
  });
});

describe("lcs", () => {
  it("returns empty array for two empty arrays", () => {
    expect(lcs([], [], (a: number, b: number) => a === b)).toEqual([]);
  });

  it("finds all matches for identical arrays", () => {
    expect(lcs([1, 2, 3], [1, 2, 3], (a, b) => a === b)).toEqual([
      { aIdx: 0, bIdx: 0 },
      { aIdx: 1, bIdx: 1 },
      { aIdx: 2, bIdx: 2 },
    ]);
  });

  it("finds subsequence match", () => {
    expect(lcs([1, 2, 3, 4], [2, 3], (a, b) => a === b)).toEqual([
      { aIdx: 1, bIdx: 0 },
      { aIdx: 2, bIdx: 1 },
    ]);
  });

  it("finds non-contiguous matches", () => {
    // [1,3,5,7] vs [2,3,6,7] — 3 matches at aIdx=1,bIdx=1 and 7 matches at aIdx=3,bIdx=3
    expect(lcs([1, 3, 5, 7], [2, 3, 6, 7], (a, b) => a === b)).toEqual([
      { aIdx: 1, bIdx: 1 },
      { aIdx: 3, bIdx: 3 },
    ]);
  });

  it("returns empty when no matches", () => {
    expect(lcs([1, 2, 3], [4, 5, 6], (a, b) => a === b)).toEqual([]);
  });

  it("returns empty for empty second array", () => {
    expect(lcs([1, 2, 3], [], (a, b) => a === b)).toEqual([]);
  });

  it("works with custom fuzzy predicate", () => {
    // predicate: abs diff <= 1 means 1~2 match, 3~3 match, 5~4 match
    const result = lcs([1, 3, 5], [2, 3, 4], (a, b) => Math.abs(a - b) <= 1);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ aIdx: 0, bIdx: 0 });
    expect(result[1]).toEqual({ aIdx: 1, bIdx: 1 });
    expect(result[2]).toEqual({ aIdx: 2, bIdx: 2 });
  });
});
