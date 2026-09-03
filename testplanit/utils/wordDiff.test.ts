import { describe, expect, it } from "vitest";
import { diffWords } from "./wordDiff";

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
