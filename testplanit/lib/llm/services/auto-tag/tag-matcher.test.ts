import { describe, expect, it } from "vitest";

import { matchTagSuggestions, normalizeTagName } from "./tag-matcher";

describe("normalizeTagName", () => {
  it("trims whitespace and lowercases", () => {
    expect(normalizeTagName("  Login  ")).toBe("login");
  });

  it("preserves internal spaces while lowercasing", () => {
    expect(normalizeTagName("API Testing")).toBe("api testing");
  });

  it("handles empty string", () => {
    expect(normalizeTagName("")).toBe("");
  });

  it("handles string with only whitespace", () => {
    expect(normalizeTagName("   ")).toBe("");
  });
});

describe("matchTagSuggestions", () => {
  it("matches exact case-insensitive tags as existing", () => {
    const result = matchTagSuggestions(
      ["Login"],
      ["login", "regression"],
      [],
    );
    expect(result).toEqual([
      { tagName: "Login", isExisting: true, matchedExistingTag: "login" },
    ]);
  });

  it("fuzzy matches substring/prefix tags", () => {
    const result = matchTagSuggestions(
      ["auth"],
      ["authentication", "regression"],
      [],
    );
    expect(result).toEqual([
      {
        tagName: "auth",
        isExisting: true,
        matchedExistingTag: "authentication",
      },
    ]);
  });

  it("marks unmatched tags as new", () => {
    const result = matchTagSuggestions(
      ["api"],
      ["login", "regression"],
      [],
    );
    expect(result).toEqual([{ tagName: "api", isExisting: false }]);
  });

  it("handles mixed existing and new tags", () => {
    const result = matchTagSuggestions(
      ["Login", "auth", "API"],
      ["login", "authentication", "regression"],
      [],
    );
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      tagName: "Login",
      isExisting: true,
      matchedExistingTag: "login",
    });
    expect(result[1]).toEqual({
      tagName: "auth",
      isExisting: true,
      matchedExistingTag: "authentication",
    });
    expect(result[2]).toEqual({ tagName: "API", isExisting: false });
  });

  it("filters out tags already on the entity", () => {
    const result = matchTagSuggestions(
      ["Login", "smoke", "new-tag"],
      ["login", "smoke", "regression"],
      ["login", "smoke"],
    );
    // "Login" matches "login" which is already on entity -> filtered
    // "smoke" exact match and already on entity -> filtered
    // "new-tag" is new
    expect(result).toEqual([{ tagName: "new-tag", isExisting: false }]);
  });

  it("returns all as new when existingProjectTags is empty", () => {
    const result = matchTagSuggestions(
      ["login", "api", "smoke"],
      [],
      [],
    );
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.isExisting === false)).toBe(true);
  });

  it("deduplicates AI suggestions", () => {
    const result = matchTagSuggestions(
      ["Login", "login", "LOGIN"],
      ["login"],
      [],
    );
    // Should only produce one entry, not three
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      tagName: "Login",
      isExisting: true,
      matchedExistingTag: "login",
    });
  });

  it("fuzzy matches close variants via Levenshtein distance", () => {
    // "ui test" vs "ui testing" — "ui test" is substring of "ui testing"
    const result = matchTagSuggestions(
      ["ui test"],
      ["ui testing"],
      [],
    );
    expect(result).toEqual([
      {
        tagName: "ui test",
        isExisting: true,
        matchedExistingTag: "ui testing",
      },
    ]);
  });

  it("exact match takes priority over fuzzy", () => {
    // "auth" should match "auth" exactly, not fuzzy to "authentication"
    const result = matchTagSuggestions(
      ["auth"],
      ["auth", "authentication"],
      [],
    );
    expect(result).toEqual([
      { tagName: "auth", isExisting: true, matchedExistingTag: "auth" },
    ]);
  });

  it("handles empty AI suggestions", () => {
    const result = matchTagSuggestions([], ["login"], []);
    expect(result).toEqual([]);
  });

  it("trims whitespace from AI suggestions", () => {
    const result = matchTagSuggestions(
      ["  login  "],
      ["login"],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.isExisting).toBe(true);
    expect(result[0]!.matchedExistingTag).toBe("login");
  });
});
