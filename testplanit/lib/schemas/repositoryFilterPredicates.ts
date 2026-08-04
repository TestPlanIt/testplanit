import { z } from "zod/v4";

import {
  BETWEEN_OPERATOR,
  FILTER_DIMENSION_KEY_PATTERN,
  FILTER_VALUE_MAX_LENGTH,
  getOperatorArity,
  type FilterDimension,
  type FilterDimensionRegistry,
} from "~/lib/repository/filterDimensions";

/**
 * One repository filter predicate. Ordered arrays of these combine with
 * implicit AND; multiple predicates per dimension are allowed (e.g.
 * `tags all [1,2]` + `tags none [5]`). Values are typed — never packed
 * `op:val` / `op|val` strings.
 *
 * Validation is registry-parameterized (the active mode's
 * FilterDimensionRegistry decides which dimensions/operators exist) and
 * lenient: an invalid predicate is dropped, never thrown.
 */
export interface FilterPredicate {
  dimension: string;
  operator: string;
  values: Array<string | number>;
}

export type FilterPredicates = FilterPredicate[];

/**
 * Structural shape before registry validation/coercion. URL parsing yields
 * all-string values; route bodies may already carry numbers.
 */
export const filterPredicateInputSchema = z.object({
  dimension: z.string().regex(FILTER_DIMENSION_KEY_PATTERN),
  operator: z.string().min(1),
  values: z.array(z.union([z.string(), z.number()])),
});

export type FilterPredicateInput = z.infer<typeof filterPredicateInputSchema>;

const INTEGER_STRING_PATTERN = /^-?\d+$/;

/**
 * Coerces one raw value per the dimension's value type. Returns null when the
 * value cannot be represented — which drops the whole predicate.
 */
function coerceValue(
  value: string | number,
  dimension: FilterDimension
): string | number | null {
  // The spec caps free-text values; applying the cap to every string value is
  // a strict superset (ids/dates/sentinels are far shorter) and bounds URLs.
  if (typeof value === "string" && value.length > FILTER_VALUE_MAX_LENGTH) {
    return null;
  }
  switch (dimension.valueType) {
    case "idList":
    case "options": {
      if (typeof value === "number") {
        return Number.isSafeInteger(value) ? value : null;
      }
      if (dimension.sentinels?.includes(value)) return value;
      if (!INTEGER_STRING_PATTERN.test(value)) return null;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) ? parsed : null;
    }
    case "userList":
      return typeof value === "number" ? String(value) : value;
    case "boolean": {
      if (value === 0 || value === 1) return value;
      if (value === "0") return 0;
      if (value === "1") return 1;
      return null;
    }
    case "number":
    case "steps": {
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
      }
      if (value.trim() === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "date": {
      if (typeof value !== "string") return null;
      // Kept as an ISO string on the wire (matrixFiltersSchema precedent);
      // the where-compiler parses at the SQL boundary.
      return Number.isNaN(Date.parse(value)) ? null : value;
    }
    case "text":
    case "link":
      return typeof value === "number" ? String(value) : value;
  }
}

function sortBetweenAscending(
  values: Array<string | number>,
  dimension: FilterDimension
): Array<string | number> {
  if (dimension.valueType === "date") {
    return [...values].sort(
      (a, b) => Date.parse(String(a)) - Date.parse(String(b))
    );
  }
  return [...values].sort((a, b) => Number(a) - Number(b));
}

/**
 * Registry-aware validation + coercion for one structurally-valid predicate.
 * Returns null (drop) for: unknown dimension, operator not in the dimension's
 * whitelist, wrong arity, or any uncoercible value. `between` values are
 * normalized ascending here, making value-sorted cache keys safe by
 * construction.
 */
export function coerceFilterPredicate(
  input: FilterPredicateInput,
  registry: FilterDimensionRegistry
): FilterPredicate | null {
  const dimension = registry.get(input.dimension);
  if (!dimension) return null;
  if (!dimension.operators.includes(input.operator)) return null;

  const arity = getOperatorArity(input.operator);
  if (!arity) return null;
  if (input.values.length < arity.min) return null;
  if (arity.max !== null && input.values.length > arity.max) return null;

  const coerced: Array<string | number> = [];
  for (const value of input.values) {
    const coercedValue = coerceValue(value, dimension);
    if (coercedValue === null) return null;
    coerced.push(coercedValue);
  }

  return {
    dimension: dimension.key,
    operator: input.operator,
    values:
      input.operator === BETWEEN_OPERATOR
        ? sortBetweenAscending(coerced, dimension)
        : coerced,
  };
}

/**
 * Strict single-predicate schema: structural parse, then registry
 * validation/coercion. safeParse fails when the predicate would be dropped.
 */
export function buildFilterPredicateSchema(registry: FilterDimensionRegistry) {
  return filterPredicateInputSchema
    .superRefine((input, ctx) => {
      if (coerceFilterPredicate(input, registry) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Predicate is invalid for the active dimension registry",
        });
      }
    })
    .transform(
      (input) => coerceFilterPredicate(input, registry) as FilterPredicate
    );
}

/**
 * Lenient collection-level schema: non-array input parses to [], invalid
 * predicates are dropped silently, valid ones are coerced. Never throws.
 */
export function buildFilterPredicatesSchema(registry: FilterDimensionRegistry) {
  const predicateSchema = buildFilterPredicateSchema(registry);
  return z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((item): FilterPredicate[] => {
        const result = predicateSchema.safeParse(item);
        return result.success ? [result.data] : [];
      })
    );
}

/**
 * Convenience wrapper for the common "parse whatever arrived" case (URL
 * params already split into candidate objects, or a route body field).
 */
export function parseFilterPredicates(
  input: unknown,
  registry: FilterDimensionRegistry
): FilterPredicate[] {
  return buildFilterPredicatesSchema(registry).parse(input);
}
