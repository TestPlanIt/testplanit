import { describe, expect, it } from "vitest";
import {
  arraysEqual,
  computeShiftRangeIds,
  generateCombinations,
  markCombinationsWithExisting,
  splitIntoColumns,
} from "./addConfigurationWizardUtils";

describe("arraysEqual", () => {
  it("returns true for the same array reference", () => {
    const a = [1, 2, 3];
    expect(arraysEqual(a, a)).toBe(true);
  });

  it("returns true for arrays with the same values in the same order", () => {
    expect(arraysEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it("returns false when the values differ", () => {
    expect(arraysEqual([1, 2, 3], [1, 2, 4])).toBe(false);
  });

  it("is order-sensitive", () => {
    expect(arraysEqual([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  it("returns false when lengths differ", () => {
    expect(arraysEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("returns true for two empty arrays", () => {
    expect(arraysEqual([], [])).toBe(true);
  });
});

describe("generateCombinations", () => {
  it("returns the canonical empty combination when input is empty", () => {
    expect(generateCombinations([])).toEqual([[]]);
  });

  it("returns each value as its own combination for a single group", () => {
    expect(generateCombinations([[1, 2, 3]])).toEqual([[1], [2], [3]]);
  });

  it("computes the cartesian product of two groups", () => {
    expect(
      generateCombinations([
        [1, 2],
        [10, 20],
      ])
    ).toEqual([
      [1, 10],
      [1, 20],
      [2, 10],
      [2, 20],
    ]);
  });

  it("computes the cartesian product of three groups", () => {
    const result = generateCombinations([[1], [2, 3], [4, 5]]);
    expect(result).toEqual([
      [1, 2, 4],
      [1, 2, 5],
      [1, 3, 4],
      [1, 3, 5],
    ]);
  });

  it("treats an empty group as producing no combinations", () => {
    // An empty group should collapse the product to zero results, matching
    // standard cartesian-product semantics.
    expect(generateCombinations([[1, 2], []])).toEqual([]);
  });
});

describe("markCombinationsWithExisting", () => {
  const existing = [
    { variants: [{ variantId: 1 }, { variantId: 2 }] },
    { variants: [{ variantId: 5 }, { variantId: 6 }, { variantId: 7 }] },
  ];

  it("flags combinations that already match an existing configuration", () => {
    const result = markCombinationsWithExisting(
      [
        [1, 2],
        [3, 4],
      ],
      existing
    );
    expect(result).toEqual([
      { combination: [1, 2], exists: true },
      { combination: [3, 4], exists: false },
    ]);
  });

  it("matches existing combinations regardless of variant order", () => {
    const result = markCombinationsWithExisting([[7, 5, 6]], existing);
    expect(result).toEqual([{ combination: [7, 5, 6], exists: true }]);
  });

  it("flags every combination as not-existing when the existing list is empty", () => {
    const result = markCombinationsWithExisting([[1], [2]], []);
    expect(result.every((c) => !c.exists)).toBe(true);
  });

  it("tolerates a null/undefined existing list", () => {
    expect(markCombinationsWithExisting([[1]], null)).toEqual([
      { combination: [1], exists: false },
    ]);
    expect(markCombinationsWithExisting([[1]], undefined)).toEqual([
      { combination: [1], exists: false },
    ]);
  });

  it("preserves input order and does not mutate the combinations", () => {
    const combos = [
      [3, 2, 1],
      [1, 2],
    ];
    const original = JSON.parse(JSON.stringify(combos));
    markCombinationsWithExisting(combos, existing);
    expect(combos).toEqual(original);
  });
});

describe("computeShiftRangeIds", () => {
  const ids = [10, 20, 30, 40, 50];

  it("returns the inclusive range when the anchor is before the current", () => {
    expect(computeShiftRangeIds(ids, 20, 40)).toEqual([20, 30, 40]);
  });

  it("returns the inclusive range when the anchor is after the current", () => {
    expect(computeShiftRangeIds(ids, 40, 20)).toEqual([20, 30, 40]);
  });

  it("returns a single id when the anchor and current are the same", () => {
    expect(computeShiftRangeIds(ids, 30, 30)).toEqual([30]);
  });

  it("returns null when the anchor is not in the list", () => {
    expect(computeShiftRangeIds(ids, 999, 30)).toBeNull();
  });

  it("returns null when the current is not in the list", () => {
    expect(computeShiftRangeIds(ids, 20, 999)).toBeNull();
  });

  it("returns the full list when the anchor is the first and current is the last", () => {
    expect(computeShiftRangeIds(ids, 10, 50)).toEqual([10, 20, 30, 40, 50]);
  });
});

describe("splitIntoColumns", () => {
  it("returns an empty array when colCount is zero or negative", () => {
    expect(splitIntoColumns([1, 2, 3], 0)).toEqual([]);
    expect(splitIntoColumns([1, 2, 3], -1)).toEqual([]);
  });

  it("returns evenly-split columns when items divide cleanly", () => {
    expect(splitIntoColumns([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("fills earlier columns first when items do not divide cleanly", () => {
    // 7 items, 3 cols → ceil(7/3) = 3 per column: [1,2,3] [4,5,6] [7].
    expect(splitIntoColumns([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ]);
  });

  it("returns empty arrays for trailing columns when items run out", () => {
    expect(splitIntoColumns([1, 2], 4)).toEqual([[1], [2], [], []]);
  });

  it("returns the whole input as the only column when colCount is 1", () => {
    expect(splitIntoColumns([1, 2, 3], 1)).toEqual([[1, 2, 3]]);
  });

  it("works with non-number element types", () => {
    expect(splitIntoColumns(["a", "b", "c", "d"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});
