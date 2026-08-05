"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { usePathname, useRouter } from "~/lib/navigation";
import {
  getOperatorArity,
  type FilterDimensionRegistry,
} from "~/lib/repository/filterDimensions";
import {
  applyReadabilityPass,
  canonicalPredicateKey,
  COMPRESSED_FILTER_PARAM,
  encodeFilterPredicatesForUrl,
  FILTER_PARAM,
  parseFilterUrlParamsWithReport,
} from "~/lib/repository/filterUrlCodec";
import {
  EMPTY_FILTER_CAP_TRUNCATION,
  hasFilterCapTruncation,
  isFilterPredicateLimitReached,
  mergeFilterCapTruncation,
  type FilterCapTruncation,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";

/**
 * URL-backed filter state for the repository FilterBar.
 *
 * Predicates live as repeated `f` query params, one per predicate
 * (`?f=templates:in:1,2&f=tags:any` — lib/repository/filterUrlCodec.ts owns
 * the grammar), so filters survive reload and are shareable. Reads parse
 * `useSearchParams().getAll("f")` leniently against the active mode's
 * dimension registry: invalid predicates (unknown dimension — including run
 * dims outside run mode — bad operator/arity/values) are dropped, never
 * thrown.
 *
 * Writes go through `router.replace(..., { scroll: false })` from
 * `~/lib/navigation` (locale preserved) — always replace, never push, so
 * filter churn does not pollute history. The query is composed from
 * `window.location.search`, NOT a useSearchParams snapshot: TreeView writes
 * `node` via raw history.replaceState and useSearchParams can lag
 * (ColumnSelection.tsx documents the same), so a snapshot would silently drop
 * a just-selected folder. Every other param (node/case/view/columns/matrix
 * filters) is preserved — only the `f` keys are deleted and re-appended.
 * A serialized-echo guard skips the write when the `f` set already matches
 * the URL; it doubles as the re-entrancy guard for URL→state sync effects.
 *
 * Above FILTER_URL_PARAM_BUDGET the readable `f` set is replaced by a single
 * compressed `fz` param (codec owns the decision and the wire format). Both
 * forms are read; `fz` wins and any `f` params next to it are ignored. Writes
 * always delete both families first, so the two never coexist in a URL this
 * hook produced. Both hard caps (MAX_FILTER_PREDICATES and
 * MAX_VALUES_PER_PREDICATE) apply on read AND write, so the URL never carries
 * more than a re-read would keep, and `truncation` reports whatever either
 * side trimmed.
 *
 * With `persistToUrl: false` (case-selection mode) state is a plain
 * useState — the URL is never read nor written, so the selection dialog
 * cannot pollute the host page's URL.
 *
 * The hook is synchronous by design — no debounce here. The FilterBar
 * debounces free-text value edits before calling setPredicates; chip
 * add/remove/operator changes write immediately.
 *
 * Contradiction handling lives in the INTERACTIVE mutators (addPredicate /
 * updatePredicate) so every surface — ViewSelector rows and FilterBar chips
 * alike — inherits it, while `setPredicates` and the URL parse path stay
 * permissive (a shared link with contradictory params renders honestly).
 */

const EMPTY_PREDICATES: FilterPredicate[] = [];

/**
 * Operators whose predicate asserts that the dimension HAS a value. `any` is
 * handled separately because both its faces qualify: bare (`tags:any` = "has a
 * value") and valued (`tags:any:1,2` = "any of these").
 */
const VALUE_ASSERTING_OPERATORS: ReadonlySet<string> = new Set([
  "in",
  "all",
  "is",
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "between",
  "on",
  "before",
  "after",
  "last7",
  "last30",
  "last90",
  "thisYear",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "domain",
]);

/** "This dimension has a value" — see VALUE_ASSERTING_OPERATORS. */
export function assertsValueExists(predicate: FilterPredicate): boolean {
  return (
    predicate.operator === "any" ||
    VALUE_ASSERTING_OPERATORS.has(predicate.operator)
  );
}

/**
 * "This dimension has NO value" — only the BARE `none`. Valued
 * `none:[ids]` ("none of these") asserts nothing about emptiness: "has tag A
 * but not tag B" is a legitimate combination.
 */
export function assertsAbsence(predicate: FilterPredicate): boolean {
  return predicate.operator === "none" && predicate.values.length === 0;
}

/**
 * Bare `none` and any value-asserting predicate on the SAME dimension are
 * mutually exclusive — together they AND to a guaranteed-empty result set,
 * which the UI let users build one click at a time (select "None", then a real
 * value). Adding either drops the other.
 */
export function predicatesConflict(
  a: FilterPredicate,
  b: FilterPredicate
): boolean {
  if (a.dimension !== b.dimension) return false;
  return (
    (assertsAbsence(a) && assertsValueExists(b)) ||
    (assertsValueExists(a) && assertsAbsence(b))
  );
}

/**
 * Drops every predicate that contradicts `added` (identity-compared, so the
 * incoming predicate itself always survives). Applied by the INTERACTIVE
 * mutators only: `setPredicates` and the URL parse path stay permissive, so a
 * shared link carrying contradictory params still renders honest, removable
 * chips instead of silently rewriting itself.
 */
export function dropConflictingPredicates(
  predicates: readonly FilterPredicate[],
  added: FilterPredicate
): FilterPredicate[] {
  return predicates.filter(
    (predicate) => predicate === added || !predicatesConflict(predicate, added)
  );
}

export interface UseRepositoryFiltersOptions {
  /** The active mode's registry (buildFilterDimensions) — the parse validator. */
  registry: FilterDimensionRegistry;
  /** false = in-memory only (selection mode); true = URL is the source of truth. */
  persistToUrl: boolean;
}

export interface UseRepositoryFiltersResult {
  predicates: FilterPredicate[];
  setPredicates: (next: FilterPredicate[]) => void;
  /**
   * Upsert keyed by (dimension, operator) — the one-chip-per-key invariant —
   * then drop whatever now contradicts it (bare `none` vs any value-asserting
   * predicate on the same dimension; see predicatesConflict).
   */
  addPredicate: (next: FilterPredicate) => void;
  /**
   * Replaces the chip addressed by (dimension, operator) with `next`, which
   * may re-key it to a different operator atomically (one URL write). No-op
   * when the target is absent. Editing away the last value of an operator
   * that requires values removes the predicate; zero-arity operators keep
   * the bare form (`tags:any` = "has a value"). Like addPredicate, the result
   * drops predicates that contradict `next`.
   */
  updatePredicate: (
    dimension: string,
    operator: string,
    next: FilterPredicate
  ) => void;
  removePredicate: (dimension: string, operator: string) => void;
  clearPredicates: () => void;
  /** Deterministic serialization for React Query keys / remount keys. */
  canonicalKey: string;
  /**
   * True once the predicate array sits at MAX_FILTER_PREDICATES — the
   * FilterBar disables Add-filter and explains why.
   */
  limitReached: boolean;
  /** What the hard caps trimmed off the incoming URL (all zeros when nothing). */
  truncation: FilterCapTruncation;
}

function sameTokens(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

export function useRepositoryFilters({
  registry,
  persistToUrl,
}: UseRepositoryFiltersOptions): UseRepositoryFiltersResult {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [localPredicates, setLocalPredicates] =
    useState<FilterPredicate[]>(EMPTY_PREDICATES);
  const [writeTruncation, setWriteTruncation] = useState<FilterCapTruncation>(
    EMPTY_FILTER_CAP_TRUNCATION
  );

  const urlParse = useMemo(
    () =>
      persistToUrl
        ? parseFilterUrlParamsWithReport(
            {
              f: searchParams.getAll(FILTER_PARAM),
              fz: searchParams.get(COMPRESSED_FILTER_PARAM),
            },
            registry
          )
        : null,
    [persistToUrl, searchParams, registry]
  );

  const predicates = urlParse ? urlParse.predicates : localPredicates;
  // Read-path truncation (what a shared over-cap link lost) merged with
  // write-path truncation (what the codec's clamp cut off a programmatic
  // setPredicates) — either one has to reach the FilterBar's notice.
  const truncation = mergeFilterCapTruncation(
    urlParse ? urlParse.truncation : EMPTY_FILTER_CAP_TRUNCATION,
    writeTruncation
  );

  const setPredicates = useCallback(
    (next: FilterPredicate[]) => {
      // The hard caps (predicate count AND values per predicate) are applied
      // by the codec, so what lands in the URL is exactly what a re-read will
      // produce — `encoding.predicates` is the clamped set, and the report
      // keeps the trim visible instead of silent.
      const encoding = encodeFilterPredicatesForUrl(next);
      setWriteTruncation(
        hasFilterCapTruncation(encoding.truncation)
          ? encoding.truncation
          : EMPTY_FILTER_CAP_TRUNCATION
      );
      if (!persistToUrl) {
        setLocalPredicates(encoding.predicates);
        return;
      }
      const query = new URLSearchParams(window.location.search);
      // Echo guard: getAll form-decodes, so the comparison holds whether the
      // address bar shows `:`/`,` readable or form-encoded.
      if (
        sameTokens(query.getAll(FILTER_PARAM), encoding.fParams) &&
        (query.get(COMPRESSED_FILTER_PARAM) ?? null) === encoding.compressed
      ) {
        return;
      }
      // Both families are cleared on every write so a compressed link that
      // shrinks back under budget cannot leave a stale `fz` shadowing the
      // freshly written `f` params.
      query.delete(FILTER_PARAM);
      query.delete(COMPRESSED_FILTER_PARAM);
      if (encoding.compressed) {
        query.set(COMPRESSED_FILTER_PARAM, encoding.compressed);
      }
      for (const token of encoding.fParams) {
        query.append(FILTER_PARAM, token);
      }
      const qs = applyReadabilityPass(query.toString());
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [persistToUrl, router, pathname]
  );

  const addPredicate = useCallback(
    (next: FilterPredicate) => {
      const index = predicates.findIndex(
        (predicate) =>
          predicate.dimension === next.dimension &&
          predicate.operator === next.operator
      );
      const upserted =
        index === -1
          ? [...predicates, next]
          : predicates.map((predicate, i) => (i === index ? next : predicate));
      setPredicates(dropConflictingPredicates(upserted, next));
    },
    [predicates, setPredicates]
  );

  const updatePredicate = useCallback(
    (dimension: string, operator: string, next: FilterPredicate) => {
      const index = predicates.findIndex(
        (predicate) =>
          predicate.dimension === dimension && predicate.operator === operator
      );
      if (index === -1) {
        return;
      }
      const removesLastValue =
        next.values.length === 0 &&
        (getOperatorArity(next.operator)?.min ?? 0) > 0;
      const result: FilterPredicate[] = [];
      predicates.forEach((predicate, i) => {
        if (i === index) {
          if (!removesLastValue) {
            result.push(next);
          }
          return;
        }
        // An operator re-key can land on another chip's (dimension, operator);
        // drop that chip to keep the one-chip-per-key invariant.
        if (
          !removesLastValue &&
          predicate.dimension === next.dimension &&
          predicate.operator === next.operator
        ) {
          return;
        }
        result.push(predicate);
      });
      setPredicates(
        removesLastValue ? result : dropConflictingPredicates(result, next)
      );
    },
    [predicates, setPredicates]
  );

  const removePredicate = useCallback(
    (dimension: string, operator: string) => {
      const next = predicates.filter(
        (predicate) =>
          !(
            predicate.dimension === dimension && predicate.operator === operator
          )
      );
      if (next.length !== predicates.length) {
        setPredicates(next);
      }
    },
    [predicates, setPredicates]
  );

  const clearPredicates = useCallback(() => {
    setPredicates(EMPTY_PREDICATES);
  }, [setPredicates]);

  const canonicalKey = useMemo(
    () => canonicalPredicateKey(predicates),
    [predicates]
  );

  return {
    predicates,
    setPredicates,
    addPredicate,
    updatePredicate,
    removePredicate,
    clearPredicates,
    canonicalKey,
    limitReached: isFilterPredicateLimitReached(predicates.length),
    truncation,
  };
}
