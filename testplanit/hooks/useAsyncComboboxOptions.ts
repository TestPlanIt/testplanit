"use client";

import { useDebounce } from "@/components/Debounce";
import { useCallback, useEffect, useRef, useState } from "react";

/** How long typing pauses before options are fetched, so a keystroke burst
 *  doesn't fire a query per character. */
export const SEARCH_DEBOUNCE_MS = 300;

export type AsyncOptionsFetcher<T> = (
  query: string,
  page: number,
  pageSize: number
) => Promise<{ results: T[]; total: number } | T[]>;

interface UseAsyncComboboxOptionsArgs<T> {
  /** Whether the dropdown is open — nothing is fetched while closed. */
  open: boolean;
  fetchOptions: AsyncOptionsFetcher<T>;
  getOptionValue: (option: T) => string | number;
  pageSize: number;
}

interface AsyncOptionsState<T> {
  options: T[];
  total: number | null;
  hasMore: boolean;
}

/**
 * Search + infinite-scroll option accumulation shared by AsyncCombobox and
 * MultiAsyncCombobox.
 *
 * The `fetchOptions(query, page, pageSize)` contract is unchanged from the
 * paged era, so call sites keep working untouched: page 0 replaces the list,
 * `loadMore()` fetches the next page and appends it. Appends dedupe by
 * `getOptionValue` because not every fetcher actually pages — local fetchers
 * built over in-memory data return the same full filtered list for every
 * page, and without the dedupe-then-stop guard the load-more sentinel would
 * refetch that list forever.
 */
export function useAsyncComboboxOptions<T>({
  open,
  fetchOptions,
  getOptionValue,
  pageSize,
}: UseAsyncComboboxOptionsArgs<T>) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, SEARCH_DEBOUNCE_MS);
  const [page, setPage] = useState(0);
  const [state, setState] = useState<AsyncOptionsState<T>>({
    options: [],
    total: null,
    hasMore: false,
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Whether a page-0 fetch has finished since the dropdown opened. The empty
  // state hangs off this rather than off `options.length` alone: between the
  // open and the effect below setting `loading`, and again for the whole first
  // fetch, the list is legitimately empty but nothing is known yet — rendering
  // "No results" there contradicts the spinner sitting on top of it.
  const [settled, setSettled] = useState(false);

  // Read through a ref inside the fetch effect: call sites pass inline
  // arrows, and tracking the identity as an effect dep would refetch every
  // render. The function is pure over its option, so staleness is harmless.
  const getValueRef = useRef(getOptionValue);
  useEffect(() => {
    getValueRef.current = getOptionValue;
  });

  // Fetch when opened, then refetch as the page or the debounced search
  // moves — debouncing keeps a keystroke burst from firing a query per
  // character. `fetchOptions` stays in the deps on purpose: local fetchers
  // built with useMemo over their data (see FacetedSearchFilters) change
  // identity when that data lands, and the list must refresh when they do.
  // Call sites must therefore pass a stable function — an inline arrow
  // refetches on every render.
  useEffect(() => {
    if (!open) {
      setSettled(false);
      return;
    }
    let ignore = false;
    const append = page > 0;
    if (append) setLoadingMore(true);
    else setLoading(true);
    void fetchOptions(debouncedSearch, page, pageSize)
      .then((result) => {
        if (ignore) return;
        let results: T[];
        let total: number | null;
        if (Array.isArray(result)) {
          results = result;
          total = null;
        } else if (
          result &&
          typeof result === "object" &&
          "results" in result &&
          "total" in result
        ) {
          results = result.results;
          total = result.total;
        } else {
          results = [];
          total = null;
        }
        setState((prev) => {
          const getValue = getValueRef.current;
          const base = append ? prev.options : [];
          const seen = new Set(base.map(getValue));
          const fresh = append
            ? results.filter((option) => !seen.has(getValue(option)))
            : results;
          const options = append ? [...base, ...fresh] : results;
          let hasMore: boolean;
          if (append && fresh.length === 0) {
            // The page produced nothing new (duplicate page, unstable sort,
            // or a fetcher that ignores paging): stop regardless of the
            // reported total, or the sentinel would refetch forever.
            hasMore = false;
          } else if (total != null) {
            hasMore = options.length < total;
          } else {
            // Array results carry no total. A full page may mean more; a
            // short page is exhausted; an overlong page means the fetcher
            // ignores paging and already returned everything.
            hasMore = results.length === pageSize;
          }
          return { options, total, hasMore };
        });
      })
      .catch((error) => {
        if (ignore) return;
        // Swallowed rather than rethrown: `finally` below still clears the
        // spinner and reveals the empty state, and an unhandled rejection here
        // would surface as a page-level error overlay for a failed option load.
        console.error("Failed to load combobox options", error);
      })
      .finally(() => {
        if (ignore) return;
        if (append) setLoadingMore(false);
        else {
          setLoading(false);
          // In `finally`, not `then`: a rejected fetch has to reveal the empty
          // state too, or a failed load leaves a blank list with no spinner
          // and no message.
          setSettled(true);
        }
      });
    return () => {
      ignore = true;
      // The aborted fetch's `.finally` is ignore-guarded, so clear this run's
      // flag here or it latches: a replace fetch that supersedes an aborted
      // append only ever touches `loading`, leaving `loadingMore` stuck true —
      // a permanent bottom spinner that also blocks all further paging.
      if (append) setLoadingMore(false);
      else setLoading(false);
    };
  }, [debouncedSearch, page, pageSize, open, fetchOptions]);

  // Restart from page 0 when the query or the fetcher changes; the in-flight
  // request for the old page is discarded by the effect's `ignore` cleanup.
  useEffect(() => {
    setPage(0);
  }, [search, fetchOptions]);

  const loadMore = useCallback(() => setPage((p) => p + 1), []);

  // For dropdown close: next open refetches page 0 fresh, and a fetch that
  // was cancelled mid-flight can't leave a spinner latched on.
  const resetPaging = useCallback(() => {
    setPage(0);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  return {
    search,
    setSearch,
    debouncedSearch,
    options: state.options,
    total: state.total,
    hasMore: state.hasMore,
    loading,
    loadingMore,
    /** True once a page-0 fetch has settled for the current open session —
     *  gates the "no results" message so it can't render under the spinner. */
    settled,
    loadMore,
    resetPaging,
  };
}
