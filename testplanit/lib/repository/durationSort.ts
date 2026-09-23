// Sort terms for the case table's duration columns (Estimate, Forecast).
//
// Both columns are sparse: most cases carry no value. Postgres treats NULL as
// the largest value, so a plain `desc` fills the first pages with blank cells
// and the sort looks like it did nothing. Every term here pins blanks to the
// end in both directions, so a click always brings the cases that HAVE a
// value to the top.
//
// Forecast is shown as two figures (manual, automated) and has no scalar of
// its own: it orders by the manual forecast first, then the automated one, so
// a case with only an automated forecast sorts after every case with a manual
// one. Callers append their own tiebreaker (the repository/run `order`) so
// offset pagination stays stable across equal values.

export type SortDirection = "asc" | "desc";

export interface NullsLastSort {
  sort: SortDirection;
  nulls: "last";
}

/** Sortable column ids that resolve to a duration sort rather than a scalar. */
export const DURATION_SORT_COLUMNS: ReadonlySet<string> = new Set([
  "estimate",
  "forecast",
]);

/** The RepositoryCases scalars a duration column sorts by, in priority order. */
const DURATION_SORT_SCALARS: Record<string, readonly string[]> = {
  estimate: ["estimate"],
  forecast: ["forecastManual", "forecastAutomated"],
};

/**
 * orderBy terms (one per scalar, priority order) for a duration column, or
 * `null` when `column` is not one. The terms are RepositoryCases-level; run
 * mode nests each under `repositoryCase`.
 */
export function durationSortTerms(
  column: string,
  direction: SortDirection
): Array<Record<string, NullsLastSort>> | null {
  const scalars = DURATION_SORT_SCALARS[column];
  if (!scalars) return null;
  return scalars.map((scalar) => ({
    [scalar]: { sort: direction, nulls: "last" as const },
  }));
}
