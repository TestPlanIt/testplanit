import { describe, it, expect } from "vitest";
import { determineTagDifferences } from "./determineTagDifferences";

describe("determineTagDifferences", () => {
  it("should identify all tags as added when previous is null", () => {
    const current = ["tagA", "tagB"];
    const previous = null as any;
    expect(determineTagDifferences(current, previous)).toEqual({
      addedTags: ["tagA", "tagB"],
      removedTags: [],
      tCommonTags: [], // Typo in original source: tCommonTags
    });
  });

  it("should identify all tags as added when previous is empty", () => {
    const current = ["tagA", "tagB"];
    const previous: string[] = [];
    expect(determineTagDifferences(current, previous)).toEqual({
      addedTags: ["tagA", "tagB"],
      removedTags: [],
      tCommonTags: [],
    });
  });

  it("should identify added tags correctly", () => {
    const current = ["tagA", "tagB", "tagC"];
    const previous = ["tagA", "tagB"];
    expect(determineTagDifferences(current, previous)).toEqual({
      addedTags: ["tagC"],
      removedTags: [],
      tCommonTags: ["tagA", "tagB"],
    });
  });

  it("should identify removed tags correctly", () => {
    const current = ["tagA"];
    const previous = ["tagA", "tagB"];
    expect(determineTagDifferences(current, previous)).toEqual({
      addedTags: [],
      removedTags: ["tagB"],
      tCommonTags: ["tagA"],
    });
  });

  it("should identify added and removed tags simultaneously", () => {
    const current = ["tagA", "tagC"];
    const previous = ["tagA", "tagB"];
    expect(determineTagDifferences(current, previous)).toEqual({
      addedTags: ["tagC"],
      removedTags: ["tagB"],
      tCommonTags: ["tagA"],
    });
  });

  it("should identify common tags correctly with no changes", () => {
    const current = ["tagA", "tagB"];
    const previous = ["tagA", "tagB"];
    expect(determineTagDifferences(current, previous)).toEqual({
      addedTags: [],
      removedTags: [],
      tCommonTags: ["tagA", "tagB"],
    });
  });

  it("should handle empty current array", () => {
    const current: string[] = [];
    const previous = ["tagA", "tagB"];
    expect(determineTagDifferences(current, previous)).toEqual({
      addedTags: [],
      removedTags: ["tagA", "tagB"],
      tCommonTags: [],
    });
  });

  it("should handle both arrays being empty", () => {
    const current: string[] = [];
    const previous: string[] = [];
    expect(determineTagDifferences(current, previous)).toEqual({
      addedTags: [],
      removedTags: [],
      tCommonTags: [],
    });
  });

  it("should handle arrays with duplicate tags (behavior depends on includes)", () => {
    const current = ["tagA", "tagA", "tagC"];
    const previous = ["tagA", "tagB", "tagB"];
    // Based on Array.includes, duplicates in source arrays don't affect the diff logic itself
    expect(determineTagDifferences(current, previous)).toEqual({
      addedTags: ["tagC"],
      removedTags: ["tagB", "tagB"], // Both 'tagB' from previous are considered removed
      tCommonTags: ["tagA", "tagA"], // Both 'tagA' from current are considered common
    });
  });
});
