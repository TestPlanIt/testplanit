export type SortMode = "date" | "status";

export interface SortableItem {
  statusId: number | null;
  statusOrder?: number | null;
}

/**
 * Sorts summary bar items into display order.
 *
 * "date" mode: preserve original (chronological) order but push untested items
 * (statusId === null or === untestedStatusId) to the end so completed work
 * appears first.
 *
 * "status" mode: sort ascending by statusOrder so items group visually by
 * status. Null statusOrder falls back to untestedOrder so unexecuted items
 * sort alongside the untested status bucket.
 *
 * Does not mutate the input array.
 */
export function sortSummaryItems<T extends SortableItem>(
  items: T[],
  mode: SortMode,
  untestedStatusId: number | undefined,
  untestedOrder: number
): T[] {
  if (mode === "date") {
    return [...items].sort((a, b) => {
      const aUntested = a.statusId === null || a.statusId === untestedStatusId;
      const bUntested = b.statusId === null || b.statusId === untestedStatusId;
      if (aUntested === bUntested) return 0;
      return aUntested ? 1 : -1;
    });
  }
  return [...items].sort(
    (a, b) =>
      (a.statusOrder ?? untestedOrder) - (b.statusOrder ?? untestedOrder)
  );
}
