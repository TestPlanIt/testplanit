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
  parseFilterParams,
  serializeFilterPredicates,
} from "~/lib/repository/filterUrlCodec";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";

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
 * With `persistToUrl: false` (case-selection mode) state is a plain
 * useState — the URL is never read nor written, so the selection dialog
 * cannot pollute the host page's URL.
 *
 * The hook is synchronous by design — no debounce here. The FilterBar
 * debounces free-text value edits before calling setPredicates; chip
 * add/remove/operator changes write immediately.
 */

const EMPTY_PREDICATES: FilterPredicate[] = [];

export interface UseRepositoryFiltersOptions {
  /** The active mode's registry (buildFilterDimensions) — the parse validator. */
  registry: FilterDimensionRegistry;
  /** false = in-memory only (selection mode); true = URL is the source of truth. */
  persistToUrl: boolean;
}

export interface UseRepositoryFiltersResult {
  predicates: FilterPredicate[];
  setPredicates: (next: FilterPredicate[]) => void;
  /** Upsert keyed by (dimension, operator) — the one-chip-per-key invariant. */
  addPredicate: (next: FilterPredicate) => void;
  /**
   * Replaces the chip addressed by (dimension, operator) with `next`, which
   * may re-key it to a different operator atomically (one URL write). No-op
   * when the target is absent. Editing away the last value of an operator
   * that requires values removes the predicate; zero-arity operators keep
   * the bare form (`tags:any` = "has a value").
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

  const urlPredicates = useMemo(
    () =>
      persistToUrl
        ? parseFilterParams(searchParams.getAll("f"), registry)
        : EMPTY_PREDICATES,
    [persistToUrl, searchParams, registry]
  );

  const predicates = persistToUrl ? urlPredicates : localPredicates;

  const setPredicates = useCallback(
    (next: FilterPredicate[]) => {
      if (!persistToUrl) {
        setLocalPredicates(next);
        return;
      }
      const query = new URLSearchParams(window.location.search);
      const tokens = serializeFilterPredicates(next);
      // Echo guard: getAll form-decodes, so the comparison holds whether the
      // address bar shows `:`/`,` readable or form-encoded.
      if (sameTokens(query.getAll("f"), tokens)) {
        return;
      }
      query.delete("f");
      for (const token of tokens) {
        query.append("f", token);
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
      setPredicates(
        index === -1
          ? [...predicates, next]
          : predicates.map((predicate, i) => (i === index ? next : predicate))
      );
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
      setPredicates(result);
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
  };
}
