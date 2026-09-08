import { describe, expect, it } from "vitest";
import { wordDiffTokens } from "./wordDiff";

const changedWords = (mine: string, theirs: string) =>
  wordDiffTokens(mine, theirs)
    .filter((t) => t.changed && t.text.trim() !== "")
    .map((t) => t.text);

describe("wordDiffTokens", () => {
  it("flags only the differing word between near-identical strings", () => {
    expect(
      changedWords(
        "view log option should display only for editabled collections",
        "view log option should display only for editable collections"
      )
    ).toEqual(["editabled"]);
  });

  it("flags nothing when the strings are identical", () => {
    expect(changedWords("same exact title", "same exact title")).toEqual([]);
  });

  it("flags an inserted word", () => {
    expect(changedWords("the quick brown fox", "the brown fox")).toEqual([
      "quick",
    ]);
  });

  it("flags a terminology swap", () => {
    expect(
      changedWords(
        "Verify usage via External Channels filter",
        "Verify usage via Room filter"
      )
    ).toEqual(["External", "Channels"]);
  });

  it("reconstructs the full original string from the tokens", () => {
    const mine = "Verify that  the widget renders";
    expect(
      wordDiffTokens(mine, "Verify the widget renders")
        .map((t) => t.text)
        .join("")
    ).toBe(mine);
  });

  it("returns empty for an empty string", () => {
    expect(wordDiffTokens("", "anything")).toEqual([]);
  });
});
