import type { RepositoryCasesWhereInput } from "~/zenstack/input";

/**
 * Cases with, or without, a suggested change waiting for a decision.
 *
 * Shared by the facet counts, the where-compiler, and the list `where`.
 */
export function suggestionsWhereClause(
  hasSuggestion: boolean
): RepositoryCasesWhereInput {
  return hasSuggestion
    ? { changeSuggestions: { some: { status: "PENDING" } } }
    : { changeSuggestions: { none: { status: "PENDING" } } };
}

/** The two-bucket facet shape the filter picker reads for boolean axes. */
export function shapeSuggestionsFacet(
  total: number,
  withSuggestion: number
): Array<{ value: boolean; count: number }> {
  return [
    { value: true, count: withSuggestion },
    { value: false, count: Math.max(0, total - withSuggestion) },
  ];
}
