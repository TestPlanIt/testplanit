/**
 * URL codec for repository filter predicates.
 *
 * Wire grammar (repeated `f` query params, one per predicate):
 *
 *   f-param = dimension ":" operator [":" values]
 *   values  = value *("," value)      ; each value encodeURIComponent'd BEFORE join
 *
 * Example: ?f=templates:in:1,2&f=tags:any&f=field_12:contains:foo%2Cbar
 *
 * Parsing is indexOf-based (never a global split(":")) so hand-typed
 * unencoded colons inside ISO dates survive. Serialization component-encodes
 * each value before joining, which is what makes the %3A/%2C readability pass
 * lossless: literal ":"/"," inside values arrive double-encoded (%253A/%252C)
 * and are untouched by the restore.
 */

import type { FilterDimensionRegistry } from "./filterDimensions";
import {
  coerceFilterPredicate,
  filterPredicateInputSchema,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";

/**
 * Parses one raw `f` param value (as returned by searchParams.getAll("f"),
 * i.e. already form-decoded once). Returns null (drop) on any malformation:
 * missing tokens, malformed % escapes, or registry/arity/coercion failure.
 */
export function parseFilterParam(
  raw: string,
  registry: FilterDimensionRegistry
): FilterPredicate | null {
  const firstColon = raw.indexOf(":");
  if (firstColon <= 0) return null;
  const dimension = raw.slice(0, firstColon);

  const secondColon = raw.indexOf(":", firstColon + 1);
  const operator =
    secondColon === -1
      ? raw.slice(firstColon + 1)
      : raw.slice(firstColon + 1, secondColon);
  if (operator.length === 0) return null;

  // Everything after the second colon is the values segment — colons inside
  // it (hand-typed ISO dates) belong to the values, not the grammar. An empty
  // segment ("tags:any:") is treated as the bare form.
  const valuesSegment = secondColon === -1 ? "" : raw.slice(secondColon + 1);
  let values: string[] = [];
  if (valuesSegment !== "") {
    try {
      values = valuesSegment
        .split(",")
        .map((piece) => decodeURIComponent(piece));
    } catch {
      return null;
    }
  }

  const structural = filterPredicateInputSchema.safeParse({
    dimension,
    operator,
    values,
  });
  if (!structural.success) return null;
  return coerceFilterPredicate(structural.data, registry);
}

/**
 * Lenient batch parse: invalid params are dropped, order is preserved.
 * Dimensions absent from the registry (e.g. run dims outside run mode) drop
 * their predicates here.
 */
export function parseFilterParams(
  rawFParams: readonly string[],
  registry: FilterDimensionRegistry
): FilterPredicate[] {
  return rawFParams.flatMap((raw): FilterPredicate[] => {
    const predicate = parseFilterParam(raw, registry);
    return predicate ? [predicate] : [];
  });
}

/** Serializes one predicate to its `f` param value (pre-URLSearchParams). */
export function serializeFilterPredicate(predicate: FilterPredicate): string {
  const head = `${predicate.dimension}:${predicate.operator}`;
  if (predicate.values.length === 0) return head;
  const values = predicate.values
    .map((value) => encodeURIComponent(String(value)))
    .join(",");
  return `${head}:${values}`;
}

/**
 * Serializes predicates to `f` param values in array order. Callers append
 * each to a URLSearchParams built from window.location.search (delete-all-
 * then-append), call .toString(), then applyReadabilityPass on the result.
 */
export function serializeFilterPredicates(
  predicates: readonly FilterPredicate[]
): string[] {
  return predicates.map(serializeFilterPredicate);
}

/**
 * Restores the structural ":" and "," that URLSearchParams.toString()
 * form-encoded, keeping URLs hand-readable. Provably lossless: any literal
 * ":"/"," inside a value was component-encoded first (%3A/%2C), then
 * form-encoded again (%253A/%252C) — strings this replace never matches.
 */
export function applyReadabilityPass(queryString: string): string {
  return queryString.replace(/%3A/g, ":").replace(/%2C/g, ",");
}

function compareStrings(a: string, b: string): number {
  // Plain code-unit comparison — locale-independent, unlike localeCompare.
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic key for React Query keys / remount keys: stable under
 * predicate reordering and value reordering. Predicates sort by dimension,
 * then operator, then serialized values; values sort within each predicate —
 * safe because `between` is parse-normalized ascending, so value order never
 * carries information.
 */
export function canonicalPredicateKey(
  predicates: readonly FilterPredicate[]
): string {
  return predicates
    .map((predicate) => ({
      dimension: predicate.dimension,
      operator: predicate.operator,
      values: [...predicate.values].map(String).sort(compareStrings),
    }))
    .sort(
      (a, b) =>
        compareStrings(a.dimension, b.dimension) ||
        compareStrings(a.operator, b.operator) ||
        compareStrings(a.values.join(","), b.values.join(","))
    )
    .map(serializeFilterPredicate)
    .join("&");
}
