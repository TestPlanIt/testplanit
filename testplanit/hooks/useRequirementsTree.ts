import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RequirementSourceFilter } from "~/app/[locale]/projects/requirements/[projectId]/requirementsListRows";
import type { RequirementCoverageFilter } from "~/lib/services/requirementCoverageFilter";
// TYPE-ONLY, and it must stay that way: `lib/services/requirementTree`
// imports `~/lib/db` and builds raw Kysely SQL. A value import here pulls
// the whole database layer into the client bundle, which Turbopack cannot
// build -- it then emits no build-manifest for the requirements page and the
// route 500s with an ENOENT that names the manifest rather than the cause.
// Types are erased at compile time, so they cost nothing at runtime.
import type {
  RequirementFilterFacets,
  RequirementRootsCursor,
  RequirementTreeRow,
} from "~/lib/services/requirementTree";

/**
 * The load-all/lazy boundary is deliberately NOT re-exported from here, and
 * is not re-implemented here either: `mode` always arrives from the server's
 * own `?countOnly=1` response (`tree/route.ts` owns the `>`/`<=` comparison
 * in one place), so this hook and the server can never disagree about which
 * side of the threshold a project is on. Server code and tests read the
 * constant from `lib/services/requirementTree` directly — a client module
 * cannot, because that module reaches the database layer (see the import
 * note above).
 */

// Page-size ceiling shared with the server's own clamp
// (`tree/route.ts`'s `REQUIREMENTS_TREE_MAX_LIMIT`) -- requesting anything
// larger would just be silently clamped down, so the hook asks for exactly
// what the server will actually return.
const REQUIREMENTS_TREE_PAGE_SIZE = 100;

export interface RequirementsTreeFilters {
  search: string;
  coverage: RequirementCoverageFilter;
  status: string;
  source: RequirementSourceFilter;
}

export interface UseRequirementsTreeArgs {
  projectId: number;
  filters: RequirementsTreeFilters;
  enabled?: boolean;
}

export interface UseRequirementsTreeResult {
  /** `null` until the server's count round trip resolves. */
  mode: "all" | "lazy" | null;
  /** The project's classified total -- unfiltered `y`. */
  total: number | null;
  isFiltering: boolean;
  /** The server's match total under an active filter -- filtered `y`. */
  matchedTotal: number | null;
  /** The matched-aware `x` -- see the module doc comment below. */
  loadedCount: number;
  /** Lazy mode only; always `[]` in `"all"` mode (D-01: the component owns
   *  every row itself below the threshold). */
  rows: RequirementTreeRow[];
  /** `null` when not filtering. */
  matchedIds: Set<number> | null;
  ancestorIds: Set<number> | null;
  expandMatchedSubtrees: boolean;
  hasMore: boolean;
  isLoading: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
  onRetryLoadMore: () => void;
  fetchChildren: (parentId: number) => Promise<void>;
  /** Call after a create/rename/reparent/delete invalidates what the count,
   *  rows, or match sets should say. */
  refetch: () => void;
  /**
   * The Status/Coverage Selects' lazy-mode option source (28-19 gap
   * closure): `collectRequirementStatusOptions`/`collectCoverageStatusOptions`
   * (`requirementsListRows.ts`) both read the all-mode-only in-memory
   * `requirements` array, which stays empty above the threshold -- this is
   * the server-side facet source the caller falls back to in that case.
   * Starts empty and fills in once the fetch below resolves; never fetched
   * at all below the threshold (mode !== "lazy"), so the below-threshold
   * path issues exactly the requests it issues today.
   */
  facets: RequirementFilterFacets;
}

interface RequirementTreeCountResponse {
  total: number;
  threshold: number;
  mode: "all" | "lazy";
}

interface RequirementRootsPageResponse {
  total: number;
  rows: RequirementTreeRow[];
  nextCursor: RequirementRootsCursor | null;
}

interface RequirementMatchPageResponse {
  total: number;
  matchedTotal: number;
  matchedIds: number[];
  ancestorIds: number[];
  rows: RequirementTreeRow[];
  nextCursor: RequirementRootsCursor | null;
  expandMatchedSubtrees: boolean;
}

/** 28-19: starting/error-fallback value for `facets` -- never `undefined`,
 *  so a caller never has to null-guard before rendering an option list. */
const EMPTY_FACETS: RequirementFilterFacets = {
  statuses: [],
  coverageStatuses: [],
};

async function fetchFacets(
  projectId: number
): Promise<RequirementFilterFacets> {
  const res = await fetch(
    `/api/projects/${projectId}/requirements/tree?facetsOnly=1`
  );
  if (!res.ok) {
    throw new Error(
      `Failed to fetch requirements tree facets (status ${res.status})`
    );
  }
  return res.json() as Promise<RequirementFilterFacets>;
}

async function fetchTreeCount(
  projectId: number
): Promise<RequirementTreeCountResponse> {
  const res = await fetch(
    `/api/projects/${projectId}/requirements/tree?countOnly=1`
  );
  if (!res.ok) {
    throw new Error(
      `Failed to fetch requirements tree count (status ${res.status})`
    );
  }
  return res.json() as Promise<RequirementTreeCountResponse>;
}

async function fetchRootsPage(
  projectId: number,
  cursor: RequirementRootsCursor | null
): Promise<RequirementRootsPageResponse> {
  const params = new URLSearchParams({
    limit: String(REQUIREMENTS_TREE_PAGE_SIZE),
  });
  if (cursor) {
    params.set("cursorName", cursor.name);
    params.set("cursorId", String(cursor.id));
  }
  const res = await fetch(
    `/api/projects/${projectId}/requirements/tree?${params.toString()}`
  );
  if (!res.ok) {
    throw new Error(
      `Failed to fetch requirements tree page (status ${res.status})`
    );
  }
  return res.json() as Promise<RequirementRootsPageResponse>;
}

async function fetchChildrenPage(
  projectId: number,
  parentId: number
): Promise<{ rows: RequirementTreeRow[] }> {
  const res = await fetch(
    `/api/projects/${projectId}/requirements/tree/${parentId}/children`
  );
  if (!res.ok) {
    throw new Error(
      `Failed to fetch requirement children (status ${res.status})`
    );
  }
  return res.json() as Promise<{ rows: RequirementTreeRow[] }>;
}

async function fetchMatches(
  projectId: number,
  args: {
    filters: RequirementsTreeFilters;
    cursor: RequirementRootsCursor | null;
    include: "ids" | "rows";
  }
): Promise<RequirementMatchPageResponse> {
  const res = await fetch(`/api/projects/${projectId}/requirements/tree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      search: args.filters.search,
      status: args.filters.status,
      source: args.filters.source,
      coverage: args.filters.coverage,
      limit: REQUIREMENTS_TREE_PAGE_SIZE,
      cursor: args.cursor,
      include: args.include,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to filter requirements tree (status ${res.status})`
    );
  }
  return res.json() as Promise<RequirementMatchPageResponse>;
}

function mergeRowsInto(
  prev: Map<number, RequirementTreeRow>,
  rows: RequirementTreeRow[]
): Map<number, RequirementTreeRow> {
  if (rows.length === 0) return prev;
  const next = new Map(prev);
  rows.forEach((row) => next.set(row.id, row));
  return next;
}

function unionIdsInto(prev: Set<number> | null, ids: number[]): Set<number> {
  const next = new Set<number>(prev ?? []);
  ids.forEach((id) => next.add(id));
  return next;
}

/**
 * The client's whole lazy-tree data model, behind one hook.
 *
 * Two mechanisms this hook owns are DELIBERATELY separate and must stay
 * that way: the ROOTS PAGER (`onLoadMore`/`hasMore`/`onRetryLoadMore`,
 * driven by `rootsCursorRef`) pages the top-level window; `fetchChildren`
 * is a smaller, unpaginated, on-demand fetch that merges into the same row
 * map without ever touching the pager's cursor, `hasMore`, or the loaded
 * count. Conflating the two would make a deep tree page unpredictably and
 * would break the "x of y" arithmetic on the very first expand.
 *
 * `loadedCount` (the matched-aware `x`):
 * - Unfiltered lazy mode: the count of ROOT rows the pager has loaded so
 *   far (`rootIdsLoaded.size`) -- NOT `rowsMap.size`, which would also grow
 *   from `fetchChildren`'s merges and make "x" jump around on every expand,
 *   independent of any real paging having happened.
 * - Filtered mode (lazy or all): the count of loaded MATCHES
 *   (`matchedIds.size`) -- ancestors are context rows, never counted, or a
 *   user would see "Showing 24 of 20".
 * - Unfiltered "all" mode: `total` -- the component already holds every row.
 *
 * "All" mode still calls the filter endpoint when a filter is active
 * (D-04: filtering is server-side at every project size); it requests
 * `include: "ids"` (the component already holds every row and needs only
 * the id sets) and SWEEPS every match page to completion internally, since
 * the component has no pagination surface of its own to expose a partial
 * match set through -- unlike lazy mode, where `hasMore`/`onLoadMore`
 * expose the match pager to the caller one window at a time.
 */
export function useRequirementsTree({
  projectId,
  filters,
  enabled = true,
}: UseRequirementsTreeArgs): UseRequirementsTreeResult {
  const [mode, setMode] = useState<"all" | "lazy" | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const [rowsMap, setRowsMap] = useState<Map<number, RequirementTreeRow>>(
    () => new Map()
  );
  const [rootIdsLoaded, setRootIdsLoaded] = useState<Set<number>>(
    () => new Set()
  );
  const [matchedIds, setMatchedIds] = useState<Set<number> | null>(null);
  const [ancestorIds, setAncestorIds] = useState<Set<number> | null>(null);
  const [matchedTotal, setMatchedTotal] = useState<number | null>(null);
  const [expandMatchedSubtrees, setExpandMatchedSubtrees] = useState(false);

  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [refetchNonce, setRefetchNonce] = useState(0);
  const [facets, setFacets] = useState<RequirementFilterFacets>(EMPTY_FACETS);

  const rootsCursorRef = useRef<RequirementRootsCursor | null>(null);
  const matchCursorRef = useRef<RequirementRootsCursor | null>(null);
  const fetchGenerationRef = useRef(0);
  const countGenerationRef = useRef(0);
  const pagingInFlightRef = useRef(false);
  const childrenLoadedRef = useRef<Set<number>>(new Set());
  const childrenInFlightRef = useRef<Set<number>>(new Set());

  const isFiltering = Boolean(
    filters.search || filters.status || filters.source || filters.coverage
  );
  const resetKey = `${projectId}|${filters.search}|${filters.status}|${filters.source}|${filters.coverage}`;

  // --- The count round trip: decides `mode`, project-scoped only. ---
  useEffect(() => {
    if (!enabled) return;
    countGenerationRef.current += 1;
    const generation = countGenerationRef.current;
    setMode(null);
    setTotal(null);
    void (async () => {
      try {
        const data = await fetchTreeCount(projectId);
        if (countGenerationRef.current !== generation) return;
        setMode(data.mode);
        setTotal(data.total);
      } catch {
        // No dedicated count-fetch error slot in this plan's interface --
        // `mode` simply never resolves, so the hook stays in its initial
        // loading state. Documented as an open decision for 28-13/28-14.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, enabled, refetchNonce]);

  // --- Facets (28-19 gap closure): the Status/Coverage Selects' lazy-mode
  // option source. Gated on `mode === "lazy"` SPECIFICALLY -- never "all",
  // never `null` -- so the below-threshold path issues exactly the requests
  // it issues today (D-01's own "no behaviour change below 500"), and so
  // this never fires while the count round trip is still deciding which
  // mode applies at all. A sibling of the count round trip above, not a
  // second lifecycle: same dependency shape (`refetchNonce` included, so a
  // mutation's `refetch()` call also refreshes the option lists a create
  // could have introduced a new status value for), but its own effect since
  // it depends on `mode`, which the count effect itself sets. `facets`
  // simply stays at its last-resolved value (empty on a first failure) on
  // error -- no dedicated error slot in this plan's interface, mirroring
  // the count round trip's own posture immediately above.
  useEffect(() => {
    if (!enabled || mode !== "lazy") return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchFacets(projectId);
        if (!cancelled) setFacets(data);
      } catch {
        // See doc comment above: facets simply keep their last-resolved
        // value rather than surfacing a second, redundant error state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled, mode, refetchNonce]);

  // --- Roots pager (unfiltered lazy mode). ---
  const loadRootsPageAndApply = useCallback(
    async (generation: number, cursor: RequirementRootsCursor | null) => {
      try {
        const page = await fetchRootsPage(projectId, cursor);
        if (fetchGenerationRef.current !== generation) return;
        setRowsMap((prev) => mergeRowsInto(prev, page.rows));
        setRootIdsLoaded((prev) => {
          const next = new Set(prev);
          page.rows.forEach((row) => next.add(row.id));
          return next;
        });
        rootsCursorRef.current = page.nextCursor;
        setHasMore(page.nextCursor !== null);
        setLoadMoreError(false);
      } catch {
        if (fetchGenerationRef.current !== generation) return;
        setLoadMoreError(true);
      } finally {
        if (fetchGenerationRef.current === generation) {
          setIsLoading(false);
        }
        pagingInFlightRef.current = false;
      }
    },
    [projectId]
  );

  // --- Filtered match pager (lazy: one window at a time; all: sweeps to
  // completion since the component has no pagination surface for it). ---
  const runFilteredFetch = useCallback(
    async (
      generation: number,
      cursor: RequirementRootsCursor | null
    ): Promise<void> => {
      const includeRows = mode === "lazy";
      try {
        const page = await fetchMatches(projectId, {
          filters,
          cursor,
          include: includeRows ? "rows" : "ids",
        });
        if (fetchGenerationRef.current !== generation) return;

        setMatchedIds((prev) => unionIdsInto(prev, page.matchedIds));
        setAncestorIds((prev) => unionIdsInto(prev, page.ancestorIds));
        setMatchedTotal(page.matchedTotal);
        setExpandMatchedSubtrees(page.expandMatchedSubtrees);
        if (includeRows && page.rows.length > 0) {
          setRowsMap((prev) => mergeRowsInto(prev, page.rows));
        }
        matchCursorRef.current = page.nextCursor;
        setLoadMoreError(false);

        if (mode === "all" && page.nextCursor !== null) {
          await runFilteredFetch(generation, page.nextCursor);
          return;
        }

        setHasMore(mode === "lazy" && page.nextCursor !== null);
      } catch {
        if (fetchGenerationRef.current !== generation) return;
        setLoadMoreError(true);
      } finally {
        if (fetchGenerationRef.current === generation) {
          setIsLoading(false);
        }
        pagingInFlightRef.current = false;
      }
    },
    [projectId, filters, mode]
  );

  // --- Reset + kick off the row/match fetch whenever the project, the
  // filters, or `mode` itself change (mode transitions null -> resolved
  // exactly once per resetKey, which is what lets this effect wait for the
  // count round trip before deciding what to fetch). ---
  useEffect(() => {
    fetchGenerationRef.current += 1;
    const generation = fetchGenerationRef.current;

    rootsCursorRef.current = null;
    matchCursorRef.current = null;
    childrenLoadedRef.current = new Set();
    childrenInFlightRef.current = new Set();
    pagingInFlightRef.current = false;

    setRowsMap(new Map());
    setRootIdsLoaded(new Set());
    setMatchedIds(null);
    setAncestorIds(null);
    setMatchedTotal(null);
    setExpandMatchedSubtrees(false);
    setLoadMoreError(false);
    setHasMore(false);

    if (!enabled || mode === null) {
      setIsLoading(Boolean(enabled));
      return;
    }

    if (isFiltering) {
      setIsLoading(true);
      pagingInFlightRef.current = true;
      void runFilteredFetch(generation, null);
    } else if (mode === "lazy") {
      setIsLoading(true);
      pagingInFlightRef.current = true;
      void loadRootsPageAndApply(generation, null);
    } else {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, mode, enabled, refetchNonce]);

  const onLoadMore = useCallback(() => {
    if (!hasMore) return;
    if (pagingInFlightRef.current) return;
    pagingInFlightRef.current = true;
    const generation = fetchGenerationRef.current;
    if (isFiltering) {
      void runFilteredFetch(generation, matchCursorRef.current);
    } else {
      void loadRootsPageAndApply(generation, rootsCursorRef.current);
    }
  }, [hasMore, isFiltering, runFilteredFetch, loadRootsPageAndApply]);

  const onRetryLoadMore = useCallback(() => {
    if (pagingInFlightRef.current) return;
    pagingInFlightRef.current = true;
    setLoadMoreError(false);
    const generation = fetchGenerationRef.current;
    if (isFiltering) {
      void runFilteredFetch(generation, matchCursorRef.current);
    } else {
      void loadRootsPageAndApply(generation, rootsCursorRef.current);
    }
  }, [isFiltering, runFilteredFetch, loadRootsPageAndApply]);

  const fetchChildren = useCallback(
    async (parentId: number) => {
      if (childrenLoadedRef.current.has(parentId)) return;
      if (childrenInFlightRef.current.has(parentId)) return;
      childrenInFlightRef.current.add(parentId);
      const generation = fetchGenerationRef.current;
      try {
        const page = await fetchChildrenPage(projectId, parentId);
        if (fetchGenerationRef.current !== generation) return;
        setRowsMap((prev) => mergeRowsInto(prev, page.rows));
        childrenLoadedRef.current.add(parentId);
      } catch {
        // No dedicated error surface for expand-on-demand in this plan's
        // interface -- only the roots/match pager exposes `loadMoreError`.
      } finally {
        childrenInFlightRef.current.delete(parentId);
      }
    },
    [projectId]
  );

  const refetch = useCallback(() => {
    setRefetchNonce((n) => n + 1);
  }, []);

  const rows = useMemo(
    () => (mode === "lazy" ? Array.from(rowsMap.values()) : []),
    [mode, rowsMap]
  );

  const loadedCount = useMemo(() => {
    if (isFiltering) return matchedIds?.size ?? 0;
    if (mode === "all") return total ?? 0;
    return rootIdsLoaded.size;
  }, [isFiltering, matchedIds, mode, total, rootIdsLoaded]);

  return {
    mode,
    total,
    isFiltering,
    matchedTotal,
    loadedCount,
    rows,
    matchedIds,
    ancestorIds,
    expandMatchedSubtrees,
    hasMore,
    isLoading,
    loadMoreError,
    onLoadMore,
    onRetryLoadMore,
    fetchChildren,
    refetch,
    facets,
  };
}
