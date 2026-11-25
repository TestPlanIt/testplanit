import { describe, expect, it } from "vitest";
import {
  shapeSuggestionsFacet,
  suggestionsWhereClause,
} from "./repositoryCaseSuggestionsFilter";

describe("suggestionsWhereClause", () => {
  it("looks only at suggestions still waiting for a decision", () => {
    expect(suggestionsWhereClause(true)).toEqual({
      changeSuggestions: { some: { status: "PENDING" } },
    });
    expect(suggestionsWhereClause(false)).toEqual({
      changeSuggestions: { none: { status: "PENDING" } },
    });
  });
});

describe("shapeSuggestionsFacet", () => {
  it("derives the no-suggestion bucket so both sum to the total", () => {
    expect(shapeSuggestionsFacet(10, 3)).toEqual([
      { value: true, count: 3 },
      { value: false, count: 7 },
    ]);
  });

  it("never goes negative", () => {
    expect(shapeSuggestionsFacet(2, 5)[1].count).toBe(0);
  });
});
