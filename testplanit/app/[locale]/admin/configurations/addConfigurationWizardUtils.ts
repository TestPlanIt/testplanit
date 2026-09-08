/**
 * Pure helpers extracted from `AddConfigurationWizard` so they can be unit
 * tested without rendering the whole multi-step dialog.
 */

/** Reference-stable check that two arrays of numbers contain the same values
 * in the same order. */
export const arraysEqual = (a: number[], b: number[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((val, index) => val === b[index]);
};

/** Generate the Cartesian product of the input arrays. Order of the inner
 * arrays follows the input order: `generateCombinations([[1,2],[3]])` yields
 * `[[1,3],[2,3]]`. An empty input returns `[[]]` (the canonical empty
 * combination) so the result is always non-empty. */
export const generateCombinations = (arrays: number[][]): number[][] => {
  if (arrays.length === 0) return [[]];
  const tail = generateCombinations(arrays.slice(1));
  return arrays[0].flatMap((value) =>
    tail.map((combination) => [value, ...combination])
  );
};

/** Sort-tolerant comparison for combinations represented as id arrays. */
const sameCombination = (a: number[], b: number[]): boolean =>
  arraysEqual([...a].sort(), [...b].sort());

/**
 * Given derived candidate combinations and the configurations that already
 * exist, annotate each candidate with an `exists` flag. The flag is true when
 * an existing configuration is built from the exact same variant ids
 * (order-independent). Used by step 2 of the wizard to render existing
 * combinations as disabled rather than filtering them out.
 */
export const markCombinationsWithExisting = (
  combinations: number[][],
  existingConfigurations:
    { variants: { variantId: number }[] }[] | null | undefined
): { combination: number[]; exists: boolean }[] => {
  return combinations.map((combination) => ({
    combination,
    exists: !!existingConfigurations?.some((config) =>
      sameCombination(
        config.variants.map((v) => v.variantId),
        combination
      )
    ),
  }));
};

/**
 * Compute the ids that should be selected when the user shift+clicks from
 * `anchorId` to `currentId` within an ordered list. Returns the inclusive
 * range between the two ids regardless of click direction. Returns `null` if
 * either id is missing from `orderedIds`, leaving the caller to fall back to
 * a single-row toggle.
 */
export const computeShiftRangeIds = (
  orderedIds: number[],
  anchorId: number,
  currentId: number
): number[] | null => {
  const fromIdx = orderedIds.indexOf(anchorId);
  const toIdx = orderedIds.indexOf(currentId);
  if (fromIdx === -1 || toIdx === -1) return null;
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  return orderedIds.slice(start, end + 1);
};

/**
 * Chunk an array into `colCount` columns of roughly equal length, filling
 * column-major (column 1 top-to-bottom, then column 2, …). This matches the
 * `ColumnSelection` table-column-picker layout — keeping shift+click range
 * selection visually intuitive because the underlying array order matches
 * the user's reading order.
 */
export const splitIntoColumns = <T>(
  items: readonly T[],
  colCount: number
): T[][] => {
  if (colCount <= 0) return [];
  const perCol = Math.ceil(items.length / colCount);
  return Array.from({ length: colCount }, (_, i) =>
    items.slice(i * perCol, (i + 1) * perCol)
  ) as T[][];
};
