import { describe, it, expect } from "vitest";
import {
  jaroWinkler,
  levenshteinRatio,
  jaccardSimilarity,
  combineScores,
  scoreToConfidence,
  FIELD_WEIGHTS,
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
