import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RequirementSourceValue } from "~/app/[locale]/projects/requirements/[projectId]/requirementsListRows";
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
  RequirementSortColumn,
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

/**
 * How many roots pages the deep-link reach-forward below may pull before it
 * gives up — 10 pages, so a linked row within the project's first thousand
 * top-level requirements is reached. Past that the wait stops being worth
 * it, and a target that is NESTED rather than a root would otherwise walk
 * the whole project without ever finding it.
 */
const LOCATE_MAX_PAGES = 10;

/** The list's default order. Mirrors `DEFAULT_REQUIREMENT_SORT` in
 *  `lib/services/requirementTree.ts`, restated here because a client module
 *  cannot import a value from that file (see the import note above). */
const DEFAULT_TREE_SORT: RequirementsTreeSort = {
  column: "name",
  direction: "asc",
};

/** Status, source and coverage are multi-select (`[]` = axis inactive);
 *  `search` is the one text box, so it stays a single string. Mirrors
 *  `RequirementListFilters` in `requirementsListRows.ts`. */
export interface RequirementsTreeFilters {
  search: string;
  coverage: RequirementCoverageFilter[];
  status: string[];
  source: RequirementSourceValue[];
}

/**
 * The sort the SERVER applies to the paged surfaces (the roots window and
 * the filtered match page). Above the lazy threshold only a window of the
 * project is ever loaded, so a sort applied in the browser would order that
 * window rather than the project -- "sort by coverage descending" would
 * miss the most-covered requirement whenever it happened to sort past the
 * first page by name (operator report). Ordering therefore travels with the
 * request.
 */
export interface RequirementsTreeSort {
  column: RequirementSortColumn;
  direction: "asc" | "desc";
}

export interface UseRequirementsTreeArgs {
  projectId: number;
  filters: RequirementsTreeFilters;
  sort?: RequirementsTreeSort;
  /**
   * A row the caller needs present in the loaded window — a deep-linked
   * selection that arrived from outside this list. Above the threshold only
   * the first roots page is fetched, so such a row may not be loaded at all;
   * the hook pages forward until it lands (bounded — see
   * `LOCATE_MAX_PAGES`). Pass `null` for a selection the user made INSIDE
   * the list: that row is already on screen, and paging toward it would be
   * pure waste.
   */
  locateId?: number | null;
  enabled?: boolean;
}

export interface UseRequirementsTreeResult {
  /** `null` until the server's count round trip resolves. */
  mode: "all" | "lazy" | null;
  /** The project's classified total, nested children included. */
  total: number | null;
  /** Top-level requirements only -- the unfiltered `y`. The roots window
   *  can never load a nested child, so counting one in the denominator
   *  makes a fully loaded list read as stalled. `null` below the threshold,
   *  where the component already holds the whole tree. */
  rootTotal: number | null;
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
  /**
   * The count round trip failed. Distinct from `loadMoreError`, which is a
   * paging failure ON TOP of rows already shown: this one means `mode` never
   * resolved, so NEITHER row source can run and the page has nothing to
   * render. A caller that ignores it shows its "no data yet" spinner
   * forever, with no error and nothing to retry.
   */
  countError: boolean;
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
  /** Top-level requirements only — the denominator the unfiltered
   *  "x of y" compares loaded root rows against. */
  rootTotal?: number;
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
  cursor: RequirementRootsCursor | null,
  sort: RequirementsTreeSort
): Promise<RequirementRootsPageResponse> {
  const params = new URLSearchParams({
    limit: String(REQUIREMENTS_TREE_PAGE_SIZE),
    sortColumn: sort.column,
    sortDirection: sort.direction,
  });
  if (cursor) {
    // Stringified on the wire whatever its type; the server casts it back
    // to the sort column's own type (see `parseRootsCursor`).
    params.set("cursorValue", String(cursor.value));
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
    sort: RequirementsTreeSort;
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
      sort: args.sort,
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
  sort = DEFAULT_TREE_SORT,
  locateId = null,
  enabled = true,
}: UseRequirementsTreeArgs): UseRequirementsTreeResult {
  const [mode, setMode] = useState<"all" | "lazy" | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  // Roots-only denominator for the unfiltered "x of y" -- see the route's
  // own note: a nested child is never a row the roots window can load.
  const [rootTotal, setRootTotal] = useState<number | null>(null);
  const [countError, setCountError] = useState(false);

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

  const isFiltering =
    filters.search !== "" ||
    filters.status.length > 0 ||
    filters.source.length > 0 ||
    filters.coverage.length > 0;
  // Sorted before joining: the comboboxes append in CLICK order, so
  // selecting A then B and B then A are the same filter but would produce
  // two different keys -- and this key is what resets the pager and
  // re-issues every fetch. Sorting makes the key a function of the SET, not
  // of the order it was assembled in.
  // The SORT is part of the reset key, not just the filters: ordering is
  // applied server-side now, so changing a column or a direction invalidates
  // every loaded page and the cursor walking them. Leaving it out would keep
  // showing the previous order's rows and then page INTO the new order from
  // the old order's cursor, interleaving two sorts in one list.
  const resetKey = [
    projectId,
    filters.search,
    [...filters.status].sort().join(","),
    [...filters.source].sort().join(","),
    [...filters.coverage].sort().join(","),
    sort.column,
    sort.direction,
  ].join("|");

  // --- The count round trip: decides `mode`, project-scoped only. ---
  useEffect(() => {
    if (!enabled) return;
    countGenerationRef.current += 1;
    const generation = countGenerationRef.current;
    setMode(null);
    setTotal(null);
    setRootTotal(null);
    setCountError(false);
    void (async () => {
      try {
        const data = await fetchTreeCount(projectId);
        if (countGenerationRef.current !== generation) return;
        setMode(data.mode);
        setTotal(data.total);
        setRootTotal(data.rootTotal ?? null);
      } catch {
        if (countGenerationRef.current !== generation) return;
        // `mode` stays null, so neither row source can run. Reported rather
        // than swallowed: without it the caller cannot tell "still loading"
        // from "this will never load", and renders a spinner that never
        // resolves and offers no retry. `refetch()` bumps `refetchNonce`,
        // which re-runs this effect, so an existing Try again control is a
        // working recovery path.
        setCountError(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, enabled, refetchNonce]);

  // --- Facets: the Status/Coverage Selects' option source. The server is
  // the only source now, at every project size -- the in-memory arrays the
  // small-project path used to collect these from no longer exist. A
  // sibling of the count round trip above, not a second lifecycle: same
  // dependency shape (`refetchNonce` included, so a mutation's `refetch()`
  // also refreshes the option lists a create could have introduced a new
  // status value for). `facets` simply stays at its last-resolved value
  // (empty on a first failure) on error -- no dedicated error slot,
  // mirroring the count round trip's own posture immediately above.
  useEffect(() => {
    if (!enabled) return;
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
  }, [projectId, enabled, refetchNonce]);

  // --- Roots pager (unfiltered). ---
  const loadRootsPageAndApply = useCallback(
    async (generation: number, cursor: RequirementRootsCursor | null) => {
      try {
        const page = await fetchRootsPage(projectId, cursor, sort);
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
        // Generation-gated, like every other side effect in this block. A
        // superseded fetch clearing the shared gate would open it while the
        // generation that REPLACED it still has a request outstanding, so
        // the scroll sentinel could fire a second fetch against the same
        // cursor -- two writers racing one cursor ref. The reset effect
        // clears this flag itself when it bumps the generation, so a
        // stale fetch never needs to.
        if (fetchGenerationRef.current === generation) {
          setIsLoading(false);
          pagingInFlightRef.current = false;
        }
      }
    },
    [projectId, sort]
  );

  // --- Filtered match pager (lazy: one window at a time; all: sweeps to
  // completion since the component has no pagination surface for it). ---
  const runFilteredFetch = useCallback(
    async (
      generation: number,
      cursor: RequirementRootsCursor | null
    ): Promise<void> => {
      // Rows always, at every project size: the client no longer holds a
      // separate in-memory copy to fall back on.
      const includeRows = true;
      try {
        const page = await fetchMatches(projectId, {
          filters,
          cursor,
          include: includeRows ? "rows" : "ids",
          sort,
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

        setHasMore(page.nextCursor !== null);
      } catch {
        if (fetchGenerationRef.current !== generation) return;
        setLoadMoreError(true);
      } finally {
        // Generation-gated, like every other side effect in this block. A
        // superseded fetch clearing the shared gate would open it while the
        // generation that REPLACED it still has a request outstanding, so
        // the scroll sentinel could fire a second fetch against the same
        // cursor -- two writers racing one cursor ref. The reset effect
        // clears this flag itself when it bumps the generation, so a
        // stale fetch never needs to.
        if (fetchGenerationRef.current === generation) {
          setIsLoading(false);
          pagingInFlightRef.current = false;
        }
      }
    },
    [projectId, filters, mode, sort]
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

    if (!enabled) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    pagingInFlightRef.current = true;
    if (isFiltering) {
      void runFilteredFetch(generation, null);
    } else {
      void loadRootsPageAndApply(generation, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, enabled, refetchNonce]);

  // --- Deep-link reach-forward. ---
  //
  // A deep link names a row the roots window may not have fetched yet: above
  // the threshold only the first page loads, so `?requirement=<root #299>`
  // pointed at a row that was simply not in the row model, and the list's own
  // scroll-into-view had nothing to scroll to (operator report). This pages
  // forward until that row arrives.
  //
  // It CANNOT be cheaper than this. The rendered list is contiguous, so
  // reaching row 299 means loading rows 0-299 whatever else is known about
  // it -- asking the server for the row's rank first would cost an extra
  // round trip and save none of these, which is why there is no rank
  // endpoint. The cap is what bounds the cost, and it also covers the case
  // this loop cannot satisfy at all: a NESTED target is never in the roots
  // window, so it would otherwise page to the end of the project looking for
  // a row that can only be revealed by expanding its parent.
  const locateAttemptsRef = useRef(0);
  useEffect(() => {
    locateAttemptsRef.current = 0;
  }, [locateId, resetKey]);
  useEffect(() => {
    if (!enabled || mode !== "lazy" || isFiltering) return;
    if (locateId == null) return;
    // Already loaded -- the caller's own scroll-into-view takes it from here.
    if (rowsMap.has(locateId)) return;
    if (!hasMore) return;
    if (pagingInFlightRef.current) return;
    if (locateAttemptsRef.current >= LOCATE_MAX_PAGES) return;
    locateAttemptsRef.current += 1;
    pagingInFlightRef.current = true;
    // Each landed page grows `rowsMap`, which re-runs this effect and pulls
    // the next one, so the walk is driven by state rather than by a loop
    // that could outlive its own generation.
    void loadRootsPageAndApply(
      fetchGenerationRef.current,
      rootsCursorRef.current
    );
  }, [
    locateId,
    rowsMap,
    hasMore,
    mode,
    isFiltering,
    enabled,
    loadRootsPageAndApply,
  ]);

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
    return rootIdsLoaded.size;
  }, [isFiltering, matchedIds, rootIdsLoaded]);

  return {
    mode,
    total,
    rootTotal,
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
    countError,
    onLoadMore,
    onRetryLoadMore,
    fetchChildren,
    refetch,
    facets,
  };
}
