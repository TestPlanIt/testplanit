import { describe, expect, it } from "vitest";
import { diffWords, groupDiffParts, type WordDiffPart } from "./wordDiff";

describe("diffWords", () => {
  it("returns one unchanged part for identical text", () => {
    expect(diffWords("a b c", "a b c")).toEqual([{ value: "a b c" }]);
  });

  it("returns nothing for two empty texts", () => {
    expect(diffWords("", "")).toEqual([]);
  });

  it("marks a replaced word without touching its neighbours", () => {
    expect(diffWords("the quick fox", "the slow fox")).toEqual([
      { value: "the " },
      { value: "quick", removed: true },
      { value: "slow", added: true },
      { value: " fox" },
    ]);
  });

  it("marks pure additions and removals at the ends", () => {
    expect(diffWords("middle", "start middle end")).toEqual([
      { value: "start ", added: true },
      { value: "middle" },
      { value: " end", added: true },
    ]);
    expect(diffWords("start middle end", "middle")).toEqual([
      { value: "start ", removed: true },
      { value: "middle" },
      { value: " end", removed: true },
    ]);
  });

  it("round-trips: removed+same parts rebuild `before`, added+same rebuild `after`", () => {
    const before = "alpha beta gamma delta epsilon";
    const after = "alpha gamma zeta epsilon omega";
    const parts = diffWords(before, after);
    const rebuiltBefore = parts
      .filter((part) => !part.added)
      .map((part) => part.value)
      .join("");
    const rebuiltAfter = parts
      .filter((part) => !part.removed)
      .map((part) => part.value)
      .join("");
    expect(rebuiltBefore).toBe(before);
    expect(rebuiltAfter).toBe(after);
  });

  it("degrades to a whole-text pair past the size cutoff instead of hanging", () => {
    const big = Array.from({ length: 1200 }, (_, i) => `w${i}`).join(" ");
    const bigChanged = Array.from({ length: 1200 }, (_, i) => `x${i}`).join(
      " "
    );
    const parts = diffWords(big, bigChanged);
    expect(parts).toEqual([
      { value: big, removed: true },
      { value: bigChanged, added: true },
    ]);
  });
});

describe("groupDiffParts", () => {
  const grouped = (before: string, after: string) =>
    groupDiffParts(diffWords(before, after));
  const text = (parts: WordDiffPart[], kind: "before" | "after") =>
    parts
      .filter((part) => (kind === "before" ? !part.added : !part.removed))
      .map((part) => part.value)
      .join("");

  it("joins changes a word or two apart into one removed and one added run", () => {
    const parts = grouped(
      "contrast in both light and dark themes.",
      "contrast in the hero section and navigation."
    );
    expect(parts).toEqual([
      { value: "contrast in " },
      { value: "both light and dark themes.", removed: true },
      { value: "the hero section and navigation.", added: true },
    ]);
  });

  it("leaves a single change as it was", () => {
    expect(grouped("below 768px viewport", "below 1024px viewport")).toEqual([
      { value: "below " },
      { value: "768px", removed: true },
      { value: "1024px", added: true },
      { value: " viewport" },
    ]);
  });

  it("keeps changes apart when more than two unchanged words separate them", () => {
    const parts = grouped(
      "open the red door and then close the blue window",
      "open the green door and then close the grey window"
    );
    expect(parts.filter((part) => part.removed).map((p) => p.value)).toEqual([
      "red",
      "blue",
    ]);
    expect(parts.filter((part) => part.added).map((p) => p.value)).toEqual([
      "green",
      "grey",
    ]);
  });

  it("handles text that is only removed or only added", () => {
    expect(grouped("keep this and drop that", "keep this")).toEqual([
      { value: "keep this" },
      { value: " and drop that", removed: true },
    ]);
    expect(grouped("keep", "keep more")).toEqual([
      { value: "keep" },
      { value: " more", added: true },
    ]);
    expect(grouped("same", "same")).toEqual([{ value: "same" }]);
    expect(grouped("", "")).toEqual([]);
  });

  it("always reads back as the two texts", () => {
    const pairs: [string, string][] = [
      ["a b c d e f", "a x c y e z"],
      ["one  two\nthree", "one two three four"],
      ["the mobile menu, and theme toggle meet", "the and mobile menu meet"],
      ["", "all new"],
      ["all old", ""],
    ];
    for (const [before, after] of pairs) {
      const parts = grouped(before, after);
      expect(text(parts, "before")).toBe(before);
      expect(text(parts, "after")).toBe(after);
    }
  });
});
