import {
  getOperatorArity,
  type FilterDimension,
} from "~/lib/repository/filterDimensions";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";

/**
 * Chip identity: one chip per (dimension, operator) — the invariant that also
 * keys the `filter-chip-{dimension}-{operator}` testids (spec §5).
 */
export function chipKey(
  predicate: Pick<FilterPredicate, "dimension" | "operator">
): string {
  return `${predicate.dimension}:${predicate.operator}`;
}

/**
 * Whether a predicate is complete enough to write to the URL: an operator the
 * dimension accepts, with its value-count contract satisfied. Draft chips
 * (Add-filter flow) and mid-edit operator switches hold until this passes.
 */
export function isCommittable(
  predicate: FilterPredicate,
  dimension: FilterDimension
): boolean {
  if (!dimension.operators.includes(predicate.operator)) return false;
  const arity = getOperatorArity(predicate.operator);
  if (!arity) return false;
  if (predicate.values.length < arity.min) return false;
  return arity.max === null || predicate.values.length <= arity.max;
}

/**
 * Seed predicate when a dimension is picked from the Add-filter menu: the
 * dimension's first registry operator, with boolean dimensions preselecting
 * true. Committable seeds (e.g. `tags:any`, `automated:is:[1]`) become chips
 * immediately; the rest stay drafts until the editor produces a valid state.
 */
export function defaultPredicateFor(
  dimension: FilterDimension
): FilterPredicate {
  return {
    dimension: dimension.key,
    operator: dimension.operators[0],
    values: dimension.valueType === "boolean" ? [1] : [],
  };
}
