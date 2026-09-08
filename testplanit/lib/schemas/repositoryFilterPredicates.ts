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
 * Hard caps. Filter state rides in the URL, so an unbounded predicate array or
 * value list is an unbounded URL. Over-cap collections TRUNCATE deterministically
 * (keep the first N, order preserved) instead of dropping everything: a shared
 * link with 60 chips still shows 50 working filters rather than an empty bar.
 * Callers learn about it through `parseFilterPredicatesWithReport` /
 * `reportFilterCapTruncation`, so the UI can say so.
 */
export const MAX_FILTER_PREDICATES = 50;
export const MAX_VALUES_PER_PREDICATE = 200;

export interface FilterCapTruncation {
  /** Predicates beyond MAX_FILTER_PREDICATES that were cut from the tail. */
  predicatesDropped: number;
  /** Dimension keys whose value lists were cut to MAX_VALUES_PER_PREDICATE. */
  valuesTruncated: string[];
}

export const EMPTY_FILTER_CAP_TRUNCATION: FilterCapTruncation = {
  predicatesDropped: 0,
  valuesTruncated: [],
};

export function hasFilterCapTruncation(
  truncation: FilterCapTruncation
): boolean {
  return (
    truncation.predicatesDropped > 0 || truncation.valuesTruncated.length > 0
  );
}

/** True when adding one more chip would exceed MAX_FILTER_PREDICATES. */
export function isFilterPredicateLimitReached(predicateCount: number): boolean {
  return predicateCount >= MAX_FILTER_PREDICATES;
}

/** True when adding one more value would exceed MAX_VALUES_PER_PREDICATE. */
export function isFilterValueLimitReached(valueCount: number): boolean {
  return valueCount >= MAX_VALUES_PER_PREDICATE;
}

/**
 * What the caps WOULD do to this collection, without coercing it. Works on any
 * predicate-shaped input (raw URL/body items included) so the report can be
 * produced next to a lenient parse.
 */
export function reportFilterCapTruncation(input: unknown): FilterCapTruncation {
  if (!Array.isArray(input)) return EMPTY_FILTER_CAP_TRUNCATION;
  const valuesTruncated: string[] = [];
  input.slice(0, MAX_FILTER_PREDICATES).forEach((item) => {
    if (typeof item !== "object" || item === null) return;
    const candidate = item as { dimension?: unknown; values?: unknown };
    if (
      Array.isArray(candidate.values) &&
      candidate.values.length > MAX_VALUES_PER_PREDICATE &&
      typeof candidate.dimension === "string"
    ) {
      valuesTruncated.push(candidate.dimension);
    }
  });
  return {
    predicatesDropped: Math.max(0, input.length - MAX_FILTER_PREDICATES),
    valuesTruncated,
  };
}

/** Keeps the first MAX_FILTER_PREDICATES entries, order preserved. */
export function applyFilterPredicateCap<T>(predicates: readonly T[]): T[] {
  return predicates.length > MAX_FILTER_PREDICATES
    ? predicates.slice(0, MAX_FILTER_PREDICATES)
    : [...predicates];
}

/** Union of two reports — a read-path report merged with a write-path one. */
export function mergeFilterCapTruncation(
  a: FilterCapTruncation,
  b: FilterCapTruncation
): FilterCapTruncation {
  if (!hasFilterCapTruncation(a)) return b;
  if (!hasFilterCapTruncation(b)) return a;
  return {
    predicatesDropped: a.predicatesDropped + b.predicatesDropped,
    valuesTruncated: Array.from(
      new Set([...a.valuesTruncated, ...b.valuesTruncated])
    ),
  };
}

export interface FilterCapClampResult {
  predicates: FilterPredicate[];
  truncation: FilterCapTruncation;
}

/**
 * The WRITE-path twin of the parse-time caps: keeps the first
 * MAX_FILTER_PREDICATES predicates and the first MAX_VALUES_PER_PREDICATE
 * values of each, and reports what it cut.
 *
 * Parse already enforces both caps (`coerceFilterPredicate` +
 * `applyFilterPredicateCap`), so without this a predicate array reaching the
 * URL writer from any route other than the FilterBar's own guards would
 * serialize over-cap and then silently lose those values on the next read.
 * Read and write agree because both go through the same two constants.
 */
export function clampFilterPredicates(
  predicates: readonly FilterPredicate[]
): FilterCapClampResult {
  const valuesTruncated: string[] = [];
  const clamped = applyFilterPredicateCap(predicates).map((predicate) => {
    if (predicate.values.length <= MAX_VALUES_PER_PREDICATE) return predicate;
    valuesTruncated.push(predicate.dimension);
    return {
      ...predicate,
      values: predicate.values.slice(0, MAX_VALUES_PER_PREDICATE),
    };
  });
  return {
    predicates: clamped,
    truncation: {
      predicatesDropped: Math.max(0, predicates.length - MAX_FILTER_PREDICATES),
      valuesTruncated,
    },
  };
}

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
 * construction. Value lists longer than MAX_VALUES_PER_PREDICATE keep their
 * first N values (the predicate survives, truncated).
 */
export function coerceFilterPredicate(
  input: FilterPredicateInput,
  registry: FilterDimensionRegistry
): FilterPredicate | null {
  const dimension = registry.get(input.dimension);
  if (!dimension) return null;
  if (!dimension.operators.includes(input.operator)) return null;

  // Truncate before the arity check: every bounded operator caps at 2 values,
  // far below MAX_VALUES_PER_PREDICATE, so truncation only ever touches the
  // unbounded ones (`in`/`any`/`all`/`none`).
  const capped =
    input.values.length > MAX_VALUES_PER_PREDICATE
      ? input.values.slice(0, MAX_VALUES_PER_PREDICATE)
      : input.values;

  const arity = getOperatorArity(input.operator);
  if (!arity) return null;
  if (capped.length < arity.min) return null;
  if (arity.max !== null && capped.length > arity.max) return null;

  const coerced: Array<string | number> = [];
  for (const value of capped) {
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
 * predicates are dropped silently, valid ones are coerced, and the result is
 * capped at MAX_FILTER_PREDICATES (first N valid predicates, order preserved).
 * Never throws.
 */
export function buildFilterPredicatesSchema(registry: FilterDimensionRegistry) {
  const predicateSchema = buildFilterPredicateSchema(registry);
  return z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      applyFilterPredicateCap(
        items.flatMap((item): FilterPredicate[] => {
          const result = predicateSchema.safeParse(item);
          return result.success ? [result.data] : [];
        })
      )
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

export interface FilterPredicatesParseResult {
  predicates: FilterPredicate[];
  truncation: FilterCapTruncation;
}

/**
 * `parseFilterPredicates` plus what the caps removed, for surfaces that must
 * tell the user their link was trimmed.
 */
export function parseFilterPredicatesWithReport(
  input: unknown,
  registry: FilterDimensionRegistry
): FilterPredicatesParseResult {
  return {
    predicates: parseFilterPredicates(input, registry),
    truncation: reportFilterCapTruncation(input),
  };
}
