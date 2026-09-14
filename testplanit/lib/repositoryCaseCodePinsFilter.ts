import type { RepositoryCasesWhereInput } from "~/zenstack/input";

/**
 * Code Pins are a soft-deleted relation on RepositoryCases, like attachments:
 * a case whose only pin was removed must count as "no code pins", so the
 * predicate always guards on `isDeleted: false`.
 *
 * `hasCodePins === true`  → cases with at least one live pin.
 * `hasCodePins === false` → cases with no live pins.
 *
 * Shared by the facet counts, the where-compiler, and the list `where`.
 */
export function codePinsWhereClause(
  hasCodePins: boolean
): RepositoryCasesWhereInput {
  return hasCodePins
    ? { codePins: { some: { isDeleted: false } } }
    : { codePins: { none: { isDeleted: false } } };
}

/** The two-bucket facet shape the ViewSelector reads for boolean axes. */
export function shapeCodePinsFacet(
  total: number,
  withCodePins: number
): Array<{ value: boolean; count: number }> {
  return [
    { value: true, count: withCodePins },
    { value: false, count: Math.max(0, total - withCodePins) },
  ];
}
