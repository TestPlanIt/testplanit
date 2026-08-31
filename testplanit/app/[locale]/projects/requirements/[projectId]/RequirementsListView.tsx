"use client";

import type { Row } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import { ClipboardPlus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { useDrop } from "react-dnd";
import { toast } from "sonner";
import {
  ColumnSelection,
  type ColumnMetadata,
  type CustomColumnDef,
} from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import type { CustomColumnMeta } from "@/components/tables/dataTableShared";
import { useDebounce } from "@/components/Debounce";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import {
  invalidateRequirementCoverage,
  useRequirementCoverage,
} from "~/hooks/useRequirementCoverage";
import { useRequirementSubtreeCount } from "~/hooks/useRequirementSubtreeCount";
import {
  useRequirementsTree,
  type RequirementsTreeFilters,
  type RequirementsTreeSort,
} from "~/hooks/useRequirementsTree";
import { ItemTypes } from "~/types/dndTypes";
import { formatIssueDisplayText } from "~/utils/issueDisplayText";
import { CreateRequirementDialog } from "./CreateRequirementDialog";
import { DeleteRequirementModal } from "./DeleteRequirementModal";
import {
  RequirementsFilterCombobox,
  type RequirementFilterOption,
} from "./RequirementsFilterCombobox";
import {
  requirementNestingGuideOffset,
  useRequirementsListColumns,
} from "./RequirementsListColumns";
import type { RequirementSelection } from "./RequirementsWorkspace";
import {
  flattenLazyRequirementRows,
  type LazyRequirementSourceRow,
  type RequirementCoverageFilter,
  type RequirementListFilters,
  type RequirementListSortConfig,
  type RequirementRow,
  type RequirementSourceValue,
} from "./requirementsListRows";

// D-04 (28-14): filters and text search are server-side at every project
// size now -- 300ms mirrors this codebase's own established search-debounce
// convention (`hooks/useAsyncComboboxOptions.ts`'s `SEARCH_DEBOUNCE_MS`):
// fast enough to feel responsive, long enough to collapse a fast typing
// burst into exactly one request. Only the search AXIS is debounced; the
// three Selects (Coverage/Status/Source) change rarely and submit
// immediately, by design (T-28-14-01).
const REQUIREMENTS_FILTER_DEBOUNCE_MS = 300;

/** The exact shape plan 03's per-row `useDrag` produces (the name cell in
 * `RequirementsListColumns.tsx`). Both drop targets below read
 * `item.requirementId`. */
interface RequirementDragItem {
  requirementId: number;
  name: string;
}

interface RequirementsListViewProps extends RequirementSelection {
  projectId: string;
  /** Asks the workspace to open this requirement in the detail panel's
   *  edit mode -- the row menu's Edit action. Optional: absent (a caller
   *  without the workspace's panel, e.g. a test harness), the menu item
   *  still renders but the request is a no-op. */
  onRequestEdit?: (issueId: number) => void;
  /** Publishes the detail panel's prev/next position over the CURRENTLY
   *  VISIBLE row order. Lifted rather than read through the imperative
   *  handle because the stepper has to re-render when the row set changes
   *  (a search, a filter, a collapse), and an imperative read cannot
   *  announce that. Mirrors `Cases.tsx`'s own `onCaseNavChange`. */
  onRequirementNavChange?: (nav: RequirementNav | null) => void;
}

/**
 * The detail panel's position within the list's own visible order. `null`
 * position means "the selected requirement is not in the current row set"
 * (filtered out, or inside a collapsed subtree) -- the panel hides the whole
 * stepper in that case rather than inventing a position, exactly as
 * `CaseDetailsPanel` does. Owned here because this view, not the workspace,
 * is what knows the post-search/post-filter/post-collapse order.
 */
export interface RequirementNav {
  position: number | null;
  total: number;
  prevId: number | null;
  nextId: number | null;
  hasPrev: boolean;
  hasNext: boolean;
}

/**
 * Imperative surface this view exposes to `RequirementsWorkspace` (gap
 * closure 26.2-16, UAT gap 13): the root-level Create Requirement dialog's
 * `open`/`parentId` state stays owned HERE (it always has -- the per-row
 * "add child" entries mutate the same state), so the page action bar's Add
 * Requirement button reaches it through a ref rather than lifting the
 * dialog itself, mirroring `IssuesCard.tsx`'s own
 * scroll-and-expand-through-a-ref convention on the milestone detail page.
 */
export interface RequirementsListViewHandle {
  /** Opens the Create Requirement dialog with parentId=null. */
  openCreateRoot: () => void;
  /** Opens the Delete Requirement dialog for `issueId`, with the descendant
   *  count resolved from this list's own in-memory map -- the same number
   *  the row action shows. This is also the detail panel's own route to the
   *  same dialog the row action opens. No-ops when the id is not in
   *  the current set. */
  openDeleteDialog: (issueId: number) => void;
}

// Gap closure 26.2-16 (UAT gap 9 rebuild): the attribute + row-lookup
// contract `markDragActive`/`clearDragActive` below toggle. `data-req-drag`
// lives on the list container; `data-req-dragged` lives on the one row
// being dragged. Every row carries these classes UNCONDITIONALLY, on the
// engine's own pointer-events-none ring overlay rather than the row's own
// box (see `getRowProps`'s `ringClassName` below -- gap closure 26.2-15,
// UAT gap 12: an inset-ring/outline painted directly on the row lost to the
// pinned Actions cell's opaque sticky background) -- visibility is 100% CSS,
// driven by the ancestor attribute, so toggling the attribute during a drag
// re-renders nothing. The third clause below is an ANCESTOR check
// (`[data-req-dragged] &`), not a same-element compound one, because
// `data-req-dragged` still lives on the ROW (the overlay's parent), never on
// the overlay itself. HARD-WON CONTEXT: a monitor-subscribed className
// toggle across the row set (the reverted plan-13 mechanism, deliberately
// not named here so a literal grep for it stays a true structural guard) is
// the exact thing that broke real HTML5 drag in Chrome (reverted in
// 1208deb2c) -- this must never regress to that shape.
const ROW_DRAG_CANDIDATE_CLASSNAME =
  "rounded [[data-req-drag=active]_&]:border-2 [[data-req-drag=active]_&]:border-dashed [[data-req-drag=active]_&]:border-muted-foreground/40 [[data-req-dragged]_&]:border-0";

const ROOT_STRIP_DRAG_CLASSNAME =
  "[[data-req-drag=active]_&]:rounded-full [[data-req-drag=active]_&]:outline-dashed [[data-req-drag=active]_&]:outline-2 [[data-req-drag=active]_&]:-outline-offset-2 [[data-req-drag=active]_&]:outline-muted-foreground/40 [[data-req-drag=active]_&]:bg-background/95";

// While a drag hovers the pill, the dashed advertisement turns into a solid
// primary outline (operator UAT -- replaced the ported blue dot+line marker).
// Plain classes are safe here: the pill is only visible mid-drag anyway.
const ROOT_STRIP_OVER_CLASSNAME =
  "rounded-full outline outline-2 -outline-offset-2 outline-primary bg-background/95";

const ROOT_STRIP_HINT_CLASSNAME =
  "pointer-events-none absolute inset-0 hidden items-center justify-center text-xs text-muted-foreground [[data-req-drag=active]_&]:flex";

/**
 * The tree-table rebuild of the requirements list (D-04a: a new file, not an
 * in-place rewrite of the earlier react-arborist tree component -- see
 * 26.2-PATTERNS.md and 26.2-RESEARCH.md Open Question 3). Owns the
 * requirement query, the
 * hierarchy/coverage/filter derivations (plan 02's pure module), the
 * toolbar, the four render states, and the `<DataTable virtualized>` call.
 * Every server contract (the query's `where`, the coverage query key, the
 * reparent route) is ported byte-identical from the file this replaces.
 */
const RequirementsListView = forwardRef<
  RequirementsListViewHandle,
  RequirementsListViewProps
>(function RequirementsListView(
  {
    projectId,
    selectedRequirementId,
    onSelectRequirement,
    onRequestEdit,
    onRequirementNavChange,
  },
  ref
) {
  const t = useTranslations();
  const queryClient = useQueryClient();

  const [filterQuery, setFilterQuery] = useState("");
  // Gap closure 26.2-12 (UAT gap 7): the milestone table's own filter idiom
  // -- Coverage/Status/Source, intersecting -- replacing the single
  // "uncovered" triangle toggle. Each axis is multi-select, so `[]` means
  // "not filtering"; values WITHIN one axis union, the axes intersect.
  const [filters, setFilters] = useState<RequirementListFilters>({
    coverage: [],
    status: [],
    source: [],
  });
  // Default {} -- every requirement starts collapsed, matching today's
  // initial tree state.
  const [expandedByIssueId, setExpandedByIssueId] = useState<
    Record<number, boolean>
  >({});
  const [createDialogState, setCreateDialogState] = useState<{
    open: boolean;
    parentId: number | null;
    parentName: string | null;
  }>({ open: false, parentId: null, parentName: null });
  const [deleteDialogState, setDeleteDialogState] = useState<{
    open: boolean;
    requirementId: number | null;
  }>({ open: false, requirementId: null });
  const [sortConfig, setSortConfig] = useState<RequirementListSortConfig>({
    column: "name",
    direction: "asc",
  });
  // The currently drag-hovered row (D-04g's lifecycle). The ref mirrors the
  // state so the list-level drop callback below can read the latest value
  // synchronously; the state drives the outline-ring render. Only event
  // handlers ever call `setDragOverRow` -- never render.
  const [dragOverRequirementId, setDragOverRequirementId] = useState<
    number | null
  >(null);
  const dragOverRequirementIdRef = useRef<number | null>(null);
  const setDragOverRow = useCallback((id: number | null) => {
    dragOverRequirementIdRef.current = id;
    setDragOverRequirementId(id);
  }, []);

  // This view owns the container the affordance CSS above keys off of, so it
  // owns the attribute lifecycle too -- the name cell (RequirementsListColumns
  // .tsx) only ever CALLS these two, never touches the DOM itself. Plain
  // functions, never a state setter: no React re-render can occur on the
  // dragstart/dragend path.
  const containerRef = useRef<HTMLDivElement>(null);
  const markDragActive = useCallback((draggedId: number) => {
    const container = containerRef.current;
    if (!container) return;
    container.setAttribute("data-req-drag", "active");
    // `requirement-row-` matches `rowTestIdPrefix` on the `<DataTable>`
    // below -- the two are coupled by construction, not by import, since
    // `rowTestIdPrefix` is a plain string prop, not an exported constant.
    container
      .querySelector(`[data-testid="requirement-row-${draggedId}"]`)
      ?.setAttribute("data-req-dragged", "true");
  }, []);
  const clearDragActive = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.removeAttribute("data-req-drag");
    // Idempotent and belt-and-braces: a cancelled drag whose dragged row
    // unmounted/remounted (e.g. a filter changed mid-drag) still gets swept
    // by attribute rather than by remembered id.
    container
      .querySelectorAll("[data-req-dragged]")
      .forEach((el) => el.removeAttribute("data-req-dragged"));
  }, []);

  const normalizedFilter = filterQuery.trim().toLowerCase();
  // Text-only, by explicit decision (gap closure 26.2-12): this gates the
  // drag gesture below, and the old uncovered toggle never gated it either
  // -- silently disabling drag under a coverage/status/source filter would
  // be a behaviour change nobody asked for.
  const isFiltering = normalizedFilter.length > 0;

  // Reparent/delete/detach are all gated server-side on project-admin, not a
  // per-area edit permission -- this mirrors that field, the same one
  // `RequirementProvenanceBadge.tsx` uses for its own detach gate.
  const { isProjectAdmin: canAddEdit } = useProjectPermissions(
    Number(projectId)
  );

  // The server decides the mode (28-CONTEXT D-01): at or below the fixed
  // threshold this component keeps its own verified load-all + full client
  // tree; above it, rows come from this hook's roots-window/expand-on-demand
  // surface instead. The threshold comparison itself is never written here --
  // `mode` is read verbatim from the hook, which reads it verbatim from the
  // server's own count round trip (`REQUIREMENT_LAZY_THRESHOLD` lives only in
  // `lib/services/requirementTree.ts`'s route). Filters and text search are
  // server-side at every project size (28-14, D-04) -- only the search axis
  // is debounced (`debouncedSearch` below); the three Selects submit the
  // instant they change.
  const debouncedSearch = useDebounce(
    normalizedFilter,
    REQUIREMENTS_FILTER_DEBOUNCE_MS
  );
  const treeFilters = useMemo<RequirementsTreeFilters>(
    () => ({
      search: debouncedSearch,
      coverage: filters.coverage,
      status: filters.status,
      source: filters.source,
    }),
    [debouncedSearch, filters.coverage, filters.status, filters.source]
  );
  // The sort travels to the server, which decides WHICH rows land in the
  // paged window. Client-side sorting stays exactly as it was and is not
  // redundant: it orders the rows already in hand (including a node's
  // expanded children, which are fetched complete and never paged), and for
  // the same column and direction it reproduces the server's own order. What
  // changes is that the window is now the project's top N by this sort
  // rather than its top N by name -- the difference between "sort the 100
  // rows I happen to have" and "sort the project".
  //
  // `sortConfig.column` is the DataTable column id, which is the same closed
  // set the service's `REQUIREMENT_SORT_COLUMNS` accepts; an id outside it
  // would be rejected by the route rather than silently ignored, so a new
  // sortable column has to be added in both places deliberately.
  // Written by every selection made from inside this list, before
  // delegating to the `onSelectRequirement` prop -- lets `scrollToRowId`
  // below distinguish "the user clicked a row in this list" (no re-center
  // needed, they're already looking at it) from "the selection arrived from
  // elsewhere" (deep link, another surface -- scroll it into view). State,
  // not a ref, so this read is render-safe.
  //
  // TWO ids, not one, and that is the whole point. `selectedRequirementId`
  // is owned by the workspace and round-trips through the URL
  // (`?requirement=`), so it lands a commit LATER than this local state. A
  // single `last === selected` test is therefore false for one render after
  // every click -- `last` already holds the new id while `selected` still
  // holds the old one -- and in that window this list told the engine to
  // scroll to the PREVIOUS selection. After scrolling a few hundred rows
  // that is a jump right out of view, with the newly clicked row nowhere on
  // screen (operator repro: select, scroll ~100 rows, select again ->
  // scrollTop 12136 -> 4448; selecting the very first row first sent it to
  // 0). It read as intermittent only because the engine's own
  // `scrolledToRef` fires once per id VALUE, so re-selecting after the same
  // previous row was silently suppressed.
  //
  // Holding the previous list selection alongside the current one covers
  // exactly that in-flight window: during it the stale `selected` is entry
  // 0, once it settles it is entry 1, and both suppress the scroll. A
  // selection that genuinely arrived from elsewhere is neither, so it still
  // gets centred.
  const [listSelectedIds, setListSelectedIds] = useState<
    readonly (number | null)[]
  >([null, null]);
  const handleSelectRequirement = useCallback(
    (issueId: number) => {
      setListSelectedIds(([, previous]) => [previous, issueId]);
      onSelectRequirement(issueId);
    },
    [onSelectRequirement]
  );
  const scrollToRequirementId = listSelectedIds.includes(selectedRequirementId)
    ? null
    : selectedRequirementId;

  const treeSort = useMemo<RequirementsTreeSort>(
    () => ({
      column: sortConfig.column as RequirementsTreeSort["column"],
      direction: sortConfig.direction,
    }),
    [sortConfig.column, sortConfig.direction]
  );
  const {
    total: projectTotal,
    rootTotal: projectRootTotal,
    rows: lazyTreeRows,
    isLoading: lazyTreeLoading,
    loadMoreError: lazyLoadMoreError,
    countError: treeCountError,
    fetchChildren,
    refetch: refetchLazyTree,
    isFiltering: treeIsFiltering,
    matchedTotal,
    loadedCount: treeLoadedCount,
    matchedIds: treeMatchedIds,
    ancestorIds: treeAncestorIds,
    hasMore: treeHasMore,
    onLoadMore: treeOnLoadMore,
    onRetryLoadMore: treeOnRetryLoadMore,
    facets: treeFacets,
  } = useRequirementsTree({
    projectId: Number(projectId),
    filters: treeFilters,
    sort: treeSort,
    // The SAME value the table's own scroll-into-view keys on, and for the
    // same reason: it is non-null only for a selection that arrived from
    // outside this list. Such a row may sit past the loaded window, so the
    // hook pages forward until it lands and the scroll then has something
    // to aim at. A row the user clicked here is already loaded, and
    // `scrollToRequirementId` is null for it, so nothing pages.
    locateId: scrollToRequirementId,
  });

  // `mode === "lazy"` is the ONLY branch that changes which data source and
  // which render pipeline are active. `mode === null` (the count round trip
  // hasn't resolved yet) deliberately falls through to the SAME branch as
  // `mode === "all"` below -- the load-all query's own `enabled: mode ===
  // "all"` gate is what keeps it from firing a real request while `mode` is
  // still null (so "neither source runs" holds in production, per this
  // plan's own interface note), and the existing "no data has arrived yet"
  // loading gate (driven by `allRequirements === undefined`) already renders
  // exactly the loading state that null-mode window needs -- no second,
  // separate `mode === null` branch is needed for rendering purposes.
  const { data: coverage, isError: coverageError } = useRequirementCoverage(
    Number(projectId)
  );
  // The Coverage Select's own disabled gate -- generalized from the old
  // triangle toggle's identical rule. The Status and Source Selects stay
  // live regardless; only the Coverage axis depends on this query.
  const coverageFilterUnavailable = !coverage || coverageError;

  // One project-scoped invalidation per mutation (create/rename/reparent-
  // success/delete), never per row. Matches the predicate-based query-key
  // stability this hook was already built with -- see the hook's own doc
  // comment for why a prefix match would collide with the covering-cases
  // query.
  const invalidateCoverage = useCallback(() => {
    invalidateRequirementCoverage(queryClient, Number(projectId));
  }, [queryClient, projectId]);

  // One refresh function for every mutation call site (create/rename/
  // reparent/delete). Collapses first: a refetch discards every loaded child
  // row and empties the hook's record of which parents have loaded, while
  // expansion state lives here and would survive it -- leaving a node drawn
  // open with nothing beneath it and no way back, since children are fetched
  // only on a chevron click and that chevron already reads as expanded.
  const refreshRequirements = useCallback(() => {
    setExpandedByIssueId({});
    refetchLazyTree();
  }, [refetchLazyTree]);

  // A failed FIRST roots page sets `loadMoreError` with nothing yet loaded,
  // which is this list's "the tree would not load at all".
  useEffect(() => {
    if (lazyLoadMoreError && lazyTreeRows.length === 0) {
      toast.error(t("requirements.tree.loadFailed"));
    }
  }, [lazyLoadMoreError, lazyTreeRows.length, t]);

  // Delay showing the spinner to avoid a flash on fast loads.
  /** Which project this view has already painted at least once. See the
   *  first-paint gate near the render states below. */
  const firstPaintDoneForProjectRef = useRef<string | null>(null);
  const [showSpinner, setShowSpinner] = useState(false);
  const isTreeBusy = lazyTreeLoading;
  useEffect(() => {
    if (isTreeBusy) {
      const timer = setTimeout(() => setShowSpinner(true), 200);
      return () => clearTimeout(timer);
    }
    setShowSpinner(false);
  }, [isTreeBusy]);

  // Option lists for the Coverage/Status Selects below (28-19 gap closure:
  // defect A). Below the threshold, unchanged from what shipped in gap
  // closure 26.2-12 -- both pure collectors reading the all-mode-only
  // `requirements` array, recomputed only when their own inputs change.
  // Server-computed, at every project size: the list holds no complete copy
  // of the project to collect distinct values from.
  const coverageStatusOptions = treeFacets.coverageStatuses;
  const requirementStatusOptions = treeFacets.statuses;

  // The three multi-select filters' option lists. Built here rather than
  // inline in the JSX because `MultiAsyncCombobox` refetches whenever its
  // `fetchOptions` identity changes, and `RequirementsFilterCombobox`
  // derives that function from this array -- an array rebuilt on every
  // render would reopen and refetch the dropdown continuously.
  const coverageFilterOptions = useMemo<RequirementFilterOption[]>(
    () => [
      { value: "UNCOVERED", label: t("requirements.coverage.uncovered") },
      { value: "UNTESTED", label: t("milestones.members.filterHasUntested") },
      ...coverageStatusOptions.map((entry) => ({
        value: `status:${entry.statusId}`,
        label: entry.name,
        count: entry.count,
      })),
    ],
    [coverageStatusOptions, t]
  );
  const statusFilterOptions = useMemo<RequirementFilterOption[]>(
    () =>
      requirementStatusOptions.map((status) => ({
        value: status,
        label: status,
      })),
    [requirementStatusOptions]
  );
  const sourceFilterOptions = useMemo<RequirementFilterOption[]>(
    () => [
      { value: "MANUAL", label: t("requirements.provenance.nativeLabel") },
      { value: "SYNCED", label: t("requirements.provenance.syncedLabel") },
      { value: "DETACHED", label: t("requirements.provenance.detachedLabel") },
    ],
    [t]
  );

  // The lazy sibling (28-12): the hook's `RequirementTreeRow` carries every
  // field this list's own renderer/columns/comparator ever read (28-08's own
  // column-list derivation proved this by reading every consumer first
  // before deciding the row shape), but omits several `Issue` columns
  // (description, data, note, ...) nothing here touches. This one cast at
  // this one boundary is the "narrow adapter", not a second row shape
  // flowing into the same renderer -- `flattenLazyRequirementRows` (28-12)
  // and every downstream column def keep working against the exact same
  // `RequirementRow` shape `flattenRequirementRows` already produces below
  // the threshold. `matchedIds` is the server's own match set (28-14, D-04)
  // -- `null` when no axis is active, so every row is in scope and no
  // match/ancestor distinction applies (28-12's own `isMatch` convention).
  const lazyModeRows = useMemo(
    () =>
      flattenLazyRequirementRows({
        rows: lazyTreeRows as unknown as LazyRequirementSourceRow[],
        expandedByIssueId,
        sortConfig,
        coverage,
        matchedIds: treeMatchedIds,
      }),
    [lazyTreeRows, expandedByIssueId, sortConfig, coverage, treeMatchedIds]
  );

  const rows = lazyModeRows;

  // A by-id lookup over the lazy hook's own loaded (partial) forest --
  // `hasChildren` for the expand-on-demand gate below, and `parentId` for
  // the ancestor walk two effects down. Deliberately NOT `requirementMap`
  // (which stays empty in lazy mode, fed only by the all-mode ZenStack
  // query): this is the lazy-mode-only counterpart, built from whatever is
  // currently loaded rather than a complete tree.
  const lazyRowsById = useMemo(
    () => new Map(lazyTreeRows.map((row) => [row.id, row])),
    [lazyTreeRows]
  );

  // Publishes the selected requirement's position in `rows` -- the same
  // array the table renders, so stepping always lands on a row the user can
  // actually see. Recomputed whenever the row set changes (search, filter,
  // collapse, sort) or the selection moves. An id that is not in `rows`
  // yields a null position, which is the panel's signal to hide the stepper
  // rather than guess.
  useEffect(() => {
    if (!onRequirementNavChange) return;
    if (selectedRequirementId == null) {
      onRequirementNavChange(null);
      return;
    }
    const index = rows.findIndex((row) => row.id === selectedRequirementId);
    if (index === -1) {
      onRequirementNavChange({
        position: null,
        total: rows.length,
        prevId: null,
        nextId: null,
        hasPrev: false,
        hasNext: false,
      });
      return;
    }
    const prevId = index > 0 ? rows[index - 1].id : null;
    const nextId = index < rows.length - 1 ? rows[index + 1].id : null;
    onRequirementNavChange({
      position: index + 1,
      total: rows.length,
      prevId,
      nextId,
      hasPrev: prevId != null,
      hasNext: nextId != null,
    });
  }, [rows, selectedRequirementId, onRequirementNavChange]);

  // Auto-expand ancestors of the selected requirement so a selection made
  // elsewhere is always reachable. Runs every time the selection changes
  // (not just once), and is a union-merge -- it only ever adds `true`
  // entries, so a user's own manual collapse is never undone by this
  // effect. Bails to the previous state object identity when nothing needs
  // adding, so this can never loop (T-26.2-12).
  //
  // 28-13 DECISION (T-28-13-04): below the threshold `requirementMap` holds
  // every requirement, so this walk always reaches every ancestor -- byte-
  // identical to the pre-lazy behavior. Above it, there is no complete
  // parent map to consult; walking an ancestor chain of unknown length by
  // fetching each link on demand would be new server/hook surface this plan
  // does not add (that fetch primitive does not exist yet, and inventing
  // one here would be exactly the kind of architectural addition this
  // plan's own scope excludes). The chosen middle ground: walk whatever
  // ancestors are ALREADY in the loaded partial forest (`lazyRowsById`) --
  // free, since it costs no extra request, and strictly better than doing
  // nothing. COST: a selection whose ancestor chain is not yet loaded
  // (e.g. a deep link, or the detail panel's prev/next landing on a row
  // outside the current window) stops climbing at the first unloaded
  // parent and may not become visible without the user expanding/loading
  // more themselves -- an accepted, documented gap, not a silent
  // regression.
  useEffect(() => {
    if (selectedRequirementId == null) return;
    const getParentId = (id: number) => lazyRowsById.get(id)?.parentId ?? null;
    setExpandedByIssueId((prev) => {
      let next: Record<number, boolean> | null = null;
      let current = getParentId(selectedRequirementId);
      while (current !== null) {
        if (prev[current] !== true) {
          next = next ?? { ...prev };
          next[current] = true;
        }
        current = getParentId(current);
      }
      return next ?? prev;
    });
  }, [selectedRequirementId, lazyRowsById]);

  // LAZY MODE ONLY: collapse everything when a filter axis changes.
  //
  // Above the threshold, a change to any axis makes `useRequirementsTree`
  // drop every loaded row and every "children already fetched" marker, and
  // children are only ever fetched by a chevron click (`handleToggleExpand`
  // below). A row left expanded across that reset therefore renders OPEN
  // WITH NOTHING UNDER IT -- its children were discarded and nothing will
  // ask for them again. Collapsing is the honest resolution rather than
  // refetching them: under an active filter a match's own subtree is
  // deliberately not auto-revealed (see the force-open effect below), so
  // re-fetching would put non-matching descendants back on screen, which is
  // precisely what the filter was asked to remove.
  const lazyFilterResetKey = [
    treeFilters.search,
    [...treeFilters.status].sort().join(","),
    [...treeFilters.source].sort().join(","),
    [...treeFilters.coverage].sort().join(","),
  ].join("|");
  const lastLazyFilterResetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const previousKey = lastLazyFilterResetKeyRef.current;
    lastLazyFilterResetKeyRef.current = lazyFilterResetKey;
    // First observation is not a filter CHANGE -- collapsing there would undo the ancestor chain the
    // selection effect above may already have opened for a deep link.
    if (previousKey === null || previousKey === lazyFilterResetKey) return;
    setExpandedByIssueId({});
  }, [lazyFilterResetKey]);

  // While a filter (search text or a Coverage/Status/Source axis) is active,
  // force open every currently-visible parent -- otherwise a filtered-in
  // descendant would never appear in the flattened array, since a row only
  // renders when its own parent's `expandedByIssueId` entry is true. Also a
  // union-merge, same loop-safety as the effect above.
  //
  // 28-14 DECISION: below the threshold, unchanged -- every id in
  // `visibleRequirementIds` (matches AND ancestors) with children is forced
  // open, exactly as before, since `expandMatchedSubtrees` already folded a
  // match's descendants into that same Set when applicable (see the memo
  // above). Above the threshold there is no complete `childrenMap` to walk,
  // and a match's OWN subtree deliberately stays collapsed (browsable
  // through expand-on-demand, not auto-revealed -- see the memo above) --
  // only the ANCESTOR chain is force-opened here, using the loaded partial
  // forest (`lazyRowsById`), which is exactly what makes a filtered match
  // reachable without eagerly fetching every matched subtree at once. A
  // no-op (identity preserved) once nothing is filtering.
  useEffect(() => {
    if (!treeAncestorIds || treeAncestorIds.size === 0) return;
    setExpandedByIssueId((prev) => {
      let next: Record<number, boolean> | null = null;
      treeAncestorIds.forEach((issueId) => {
        if (prev[issueId] === true) return;
        if (!lazyRowsById.get(issueId)?.hasChildren) return;
        next = next ?? { ...prev };
        next[issueId] = true;
      });
      return next ?? prev;
    });
  }, [treeAncestorIds, lazyRowsById]);

  const handleSortChange = useCallback((column: string) => {
    setSortConfig((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  // Explicit-direction sort from the header column menu; `null` (Remove
  // sort) restores this list's default order.
  const handleSortColumn = useCallback(
    (column: string, direction: "asc" | "desc" | null) => {
      if (direction === null) {
        setSortConfig({ column: "name", direction: "asc" });
      } else {
        setSortConfig({ column, direction });
      }
    },
    []
  );

  // The row menu's Edit routes to the detail panel's edit mode (operator
  // decision 2026-08-26, replacing the old inline rename): the panel is the
  // single editing surface, and its own save path already carries the
  // rename discipline this view used to hold -- trim, blank no-op,
  // name+title written together, locked rows refused.
  const handleRequestEdit = useCallback(
    (requirement: RequirementRow) => {
      onRequestEdit?.(requirement.id);
    },
    [onRequestEdit]
  );

  // In lazy mode, expanding (never collapsing) a node whose children are
  // not yet loaded fetches them once. `hasChildren` comes from the loaded
  // row's own server-supplied flag (`lazyRowsById`, never re-derived from
  // what's already merged in) -- D-02's whole point is that the chevron
  // (and, by extension, whether an expand should fetch) is right BEFORE any
  // click, not discovered by attempting one. The state flip stays
  // synchronous so the chevron responds immediately; `fetchChildren` itself
  // is a no-op if this node's children are already loaded or already
  // in-flight (28-11's own contract), so a collapse/re-expand cycle never
  // refetches -- this handler doesn't need to track that itself.
  const handleToggleExpand = useCallback(
    (issueId: number) => {
      const wasExpanded = expandedByIssueId[issueId] === true;
      setExpandedByIssueId((prev) => ({ ...prev, [issueId]: !prev[issueId] }));
      if (wasExpanded) return;
      if (lazyRowsById.get(issueId)?.hasChildren) {
        void fetchChildren(issueId);
      }
    },
    [expandedByIssueId, lazyRowsById, fetchChildren]
  );

  const handleAddChild = useCallback((requirement: RequirementRow) => {
    setCreateDialogState({
      open: true,
      parentId: requirement.id,
      parentName: formatIssueDisplayText(requirement),
    });
  }, []);

  // Computed once, at click time -- never recomputed reactively inside the
  // modal, so the number the user confirms against cannot drift mid-dialog.
  // Below the threshold this IS the number the modal renders (28-CONTEXT's
  // discretion note: the in-memory count stays there). Above the threshold
  // `childrenMap` is a partial forest, so this walk under-reports (usually
  // 0) for an unexpanded root -- `modalDescendantCount` below replaces it
  // with the server round trip in that branch; this state field is simply
  // unused input to that replacement in lazy mode, never rendered directly.
  //
  // Declared ABOVE `useImperativeHandle` below (not after it, as it once
  // was): the imperative factory's dependency array is evaluated at the
  // call site, and a `handleRequestDelete` still in the temporal dead zone
  // there throws a `ReferenceError` on first render.
  // Typed as `{ id: number }` rather than the full `RequirementRow` -- only
  // `.id` is ever read here, and this keeps both call sites structurally
  // valid: the row action hands a flattened `RequirementRow` (which has
  // `depth`/`hasChildren`), while `openDeleteDialog` below hands a row from
  // the loaded forest (which does not).
  //
  // The descendant count is NOT computed here. It comes from the server, per
  // dialog opening, through `useRequirementSubtreeCount` below: this list
  // holds only a loaded window of the project, so an in-memory walk would
  // under-report a subtree whose rows have not been fetched -- and a delete
  // confirmation that under-reports is the one number that must never be
  // wrong.
  const handleRequestDelete = useCallback((requirement: { id: number }) => {
    setDeleteDialogState({ open: true, requirementId: requirement.id });
  }, []);

  // Lazy mode's server-sourced replacement for the in-memory walk above
  // (28-15, T-28-15-01): `enabled` ties to the dialog's own `open` state, so
  // the round trip fires once when a delete is requested and never refetches
  // while the dialog stays open (the same query key persists for the whole
  // open lifetime).
  const {
    count: lazySubtreeCount,
    isLoading: lazySubtreeCountLoading,
    isError: lazySubtreeCountFailed,
  } = useRequirementSubtreeCount({
    projectId: Number(projectId),
    requirementId: deleteDialogState.requirementId,
    enabled: deleteDialogState.open,
  });

  // The single value the modal actually renders. Below the threshold: the
  // in-memory count computed above, unchanged. Above it, while the dialog is
  // open: `null` until the server round trip resolves (never 0 -- the modal
  // renders `null` as a loading state and disables its own confirm action
  // rather than show a number that might undercount), then the resolved
  // count. While the dialog is closed the value is moot (the modal itself
  // unmounts/hides on `open={false}`); `0` is just an inert placeholder.
  //
  // A FAILED round trip is `null` too, and the count is never defaulted to a
  // number. React Query reports `isLoading: false` on an errored query whose
  // `data` is still undefined, so an error would otherwise land on the same
  // branch as a resolved count -- rendering "no children" over a subtree
  // nobody counted and leaving the destructive confirm enabled.
  const modalDescendantCount = !deleteDialogState.open
    ? 0
    : lazySubtreeCountLoading || lazySubtreeCountFailed
      ? null
      : lazySubtreeCount;

  // The page action bar's Add Requirement button lives in
  // `RequirementsWorkspace.tsx`, outside this component -- it reaches this
  // same dialog state through this ref instead of the dialog itself moving
  // up a level. `openDeleteDialog` is the detail panel's equivalent route to
  // the delete dialog -- it delegates to `handleRequestDelete` above rather
  // than duplicating the `setDeleteDialogState` call, so the row action and
  // the panel action can never drift on the next change to the dialog's
  // state shape.
  useImperativeHandle(
    ref,
    () => ({
      openCreateRoot: () => {
        setCreateDialogState({ open: true, parentId: null, parentName: null });
      },
      openDeleteDialog: (issueId: number) => {
        // The panel's selection and this list's filtered/loaded set are
        // separate pieces of state -- a filtered-out or since-deleted
        // selection is reachable today, so an unknown id cannot open a
        // dialog for a row this list can't find; it toasts instead of
        // silently doing nothing.
        //
        // Read from whichever map this mode actually populates.
        // `requirementMap` is built from `requirements`, which stays `[]`
        // above the threshold, so consulting it in lazy mode would make the
        // guard above fire for every id and turn the panel's Delete into a
        // permanent no-op on exactly the projects lazy mode exists for.
        const requirement = lazyRowsById.get(issueId);
        if (!requirement) {
          toast.error(t("requirements.delete.failed"));
          return;
        }
        handleRequestDelete(requirement);
      },
    }),
    [lazyRowsById, handleRequestDelete, t]
  );

  const handleDetached = useCallback(() => {
    refreshRequirements();
  }, [refreshRequirements]);

  // 28-19 (gap closure, defect B): a readiness signal true in BOTH modes,
  // replacing the guard's old `!allRequirements` term below. That term was
  // never load-bearing for correctness (see `handleMove`'s own comment: the
  // server's cycle guard is the sole authority, there is no client-side
  // pre-check and no local reorder) -- it was only ever a "has the data
  // arrived yet" proxy, and it broke permanently above the threshold: once
  // `mode` resolves to `"lazy"`, the load-all query stays `enabled: false`
  // for the component's whole lifetime, so its `data` stays `undefined`
  // forever (never a truthy `[]`) and the guard silently blocked every
  // drop, with no request and no toast (28-15's own characterization).
  //
  // The replacement reads the rows the list ACTUALLY has, per mode. Below
  // the threshold: has the load-all query returned an array at all (empty
  // or not) rather than still being in flight -- `allRequirements` itself,
  // unchanged, so the below-threshold path's guard behavior is untouched.
  // Above it: has at least one row of the lazy hook's own loaded partial
  // forest arrived (`lazyRowsById`, the SAME loaded set 28-15's drop-
  // target-equals-loaded-rows test pins) -- every rendered drop target IS
  // a loaded row, so if none has loaded there is no row a drop event could
  // legitimately target in the first place; this is a readiness gate, not
  // a correctness check.
  const hasLoadedRequirements = lazyRowsById.size > 0;

  // The reparent gesture's server contract (D-04c: no optimistic accept --
  // the fetch is awaited before any UI state changes, no local array
  // reorder is attempted, and no client-side cycle pre-check exists; the
  // server's own guard stays the sole authority).
  const handleMove = useCallback(
    async ({
      draggedId,
      parentId,
    }: {
      draggedId: number;
      parentId: number | null;
    }) => {
      if (!canAddEdit || isFiltering || !hasLoadedRequirements) return;
      if (draggedId === parentId) return;
      try {
        const res = await fetch(
          `/api/projects/${projectId}/requirements/${draggedId}/reparent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parentId }),
          }
        );
        if (!res.ok) {
          let serverMessage = "";
          try {
            const errorBody = await res.json();
            if (typeof errorBody?.error === "string") {
              serverMessage = errorBody.error;
            }
          } catch {
            // No JSON body to read -- fall back to the generic rejection
            // message alone.
          }
          toast.error(
            `${t("requirements.tree.moveRejected")} ${serverMessage}`.trim()
          );
          // Snap the array back to persisted truth. Coverage is
          // deliberately NOT invalidated on this branch -- a rejected move
          // never touched the rollup.
          refreshRequirements();
          return;
        }
        toast.success(t("requirements.tree.moveSuccess"));
        refreshRequirements();
        invalidateCoverage();
      } catch (error) {
        console.error("Failed to reparent requirement:", error);
        toast.error(t("requirements.tree.moveFailed"));
      }
    },
    [
      canAddEdit,
      isFiltering,
      hasLoadedRequirements,
      projectId,
      t,
      refreshRequirements,
      invalidateCoverage,
    ]
  );

  // The single list-level drop target (D-04b). The wrapper this attaches to
  // is taller than the row set whenever the list is short, so the hovered
  // id is the only reliable signal for "which row is actually being
  // targeted" -- a null id means the pointer is over blank space below the
  // last row, and the drop must bail rather than reparent against a stale
  // target (D-04g).
  const [{ isOverList }, listDropRef] = useDrop<
    RequirementDragItem,
    void,
    { isOverList: boolean }
  >(
    () => ({
      accept: ItemTypes.REQUIREMENT,
      canDrop: () => canAddEdit && !isFiltering,
      drop: (item, monitor) => {
        if (monitor.didDrop()) return;
        const targetId = dragOverRequirementIdRef.current;
        setDragOverRow(null);
        if (targetId == null || targetId === item.requirementId) return;
        void handleMove({ draggedId: item.requirementId, parentId: targetId });
      },
      collect: (monitor) => ({
        isOverList: monitor.isOver() && monitor.canDrop(),
      }),
    }),
    [canAddEdit, isFiltering, handleMove]
  );

  // Clears the ring when the pointer leaves the table entirely -- one of
  // the three events that clear the hovered id (D-04g); the other two are
  // the row's own leave handler in `getRowProps` and the drop itself above.
  useEffect(() => {
    if (!isOverList) setDragOverRow(null);
  }, [isOverList, setDragOverRow]);

  // Bottom-of-list root drop zone -- moves a requirement out to the root
  // level. Rendered as a sibling below the scroll wrapper, never inside it,
  // so the two drop targets never nest and the wrapper's own blank strip
  // stays a dead zone.
  const [{ isOverBottom }, bottomDropRef] = useDrop<
    RequirementDragItem,
    void,
    { isOverBottom: boolean }
  >(
    () => ({
      accept: ItemTypes.REQUIREMENT,
      canDrop: () => canAddEdit && !isFiltering,
      drop: (item) => {
        void handleMove({ draggedId: item.requirementId, parentId: null });
      },
      collect: (monitor) => ({
        isOverBottom: monitor.isOver() && monitor.canDrop(),
      }),
    }),
    [canAddEdit, isFiltering, handleMove]
  );

  // Per-row extension point (plan 01's `getRowProps`): inert DOM props
  // only, no hook call and no ref slot -- publishes "I am hovered" /
  // "I am no longer hovered" through native drag events so the single
  // `useDrop` above can read the current target synchronously.
  const getRowProps = useCallback(
    (row: Row<any>) => {
      const requirement = row.original as RequirementRow;
      if (!canAddEdit || isFiltering) return {};
      return {
        onDragEnter: () => setDragOverRow(requirement.id),
        onDragLeave: (event: DragEvent<HTMLDivElement>) => {
          // Swallows the `dragleave` the browser fires when the pointer
          // crosses from the row into one of the row's own cells.
          if (
            event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            return;
          }
          // HTML5 fires `dragenter` on the new row before `dragleave` on
          // the old one -- compare against the ref (never the render-time
          // state, which may be a frame stale) so a fast A->B move doesn't
          // clear B's freshly-set id.
          if (dragOverRequirementIdRef.current === requirement.id) {
            setDragOverRow(null);
          }
        },
        // `ROW_DRAG_CANDIDATE_CLASSNAME` is present on EVERY droppable row
        // regardless of drag state -- it is inert until `data-req-drag`
        // appears on the container (pure CSS), so appending the existing
        // hover-outline class here never toggles a NEW class during a drag,
        // only the pre-existing, operator-proven hover path does. Rendered
        // on the engine's ring overlay (`ringClassName`), not the row's own
        // `className` -- gap closure 26.2-15, UAT gap 12.
        ringClassName:
          dragOverRequirementId === requirement.id
            ? `${ROW_DRAG_CANDIDATE_CLASSNAME} outline outline-2 outline-primary -outline-offset-2`
            : ROW_DRAG_CANDIDATE_CLASSNAME,
      };
    },
    [canAddEdit, isFiltering, dragOverRequirementId, setDragOverRow]
  );

  const columns = useRequirementsListColumns({
    translations: {
      columnName: t("requirements.list.columnName"),
      columnStatus: t("requirements.list.columnStatus"),
      columnCoverage: t("requirements.coverage.title"),
      columnLinkedCases: t("requirements.linkedCases.title"),
      columnCoveringCases: t("requirements.coverage.panelTitle"),
      columnSource: t("requirements.list.columnSource"),
      // D-17: reused, not new -- `common.fields.priority` already backs the
      // Priority field elsewhere in this codebase.
      columnPriority: t("common.fields.priority"),
      // Gap closure 26.2-17: reused, not new -- `common.fields.createdAt`
      // already backs every other DataTable's own hidden-by-default Created
      // column in this codebase (admin/llm, admin/integrations, etc.).
      columnCreatedAt: t("common.fields.createdAt"),
      actionsLabel: t("common.actions.actionsLabel"),
    },
    projectId: Number(projectId),
    canAddEdit,
    isFiltering,
    normalizedFilter,
    coverage,
    expandedByIssueId,
    onToggleExpand: handleToggleExpand,
    onSelectRequirement: handleSelectRequirement,
    onAddChild: handleAddChild,
    onRequestEdit: handleRequestEdit,
    onRequestDelete: handleRequestDelete,
    onDetached: handleDetached,
    markDragActive,
    clearDragActive,
  });

  // Gap closure 26.2-17 (reworked): `VirtualizedTableEngine.tsx` (this view's
  // own `<DataTable virtualized>` mode) passes `columnVisibility` straight
  // through to `useReactTable`'s state with no `meta.isVisible` fallback of
  // its own -- that derivation lives ONLY in `PagedTable`'s internal
  // `getInitialVisibility`. Without seeding it here, a hidden-by-default
  // column (createdAt) would render VISIBLE on first paint, since TanStack
  // treats an id absent from the map as visible. Deliberately NO
  // first/last-always-visible clause (unlike `Cases.tsx`'s seed): this
  // initializer runs at view mount, while `useProjectPermissions` is still
  // resolving, so `columns` omits `actions` and createdAt IS the last column
  // -- an index rule would bake it visible forever (a live cold-load bug).
  // Neither anchor needs the rule anyway: `name` and `actions` carry no
  // `meta.isVisible`, so they default visible. Once the Columns control below
  // mounts it becomes the single owner of this map.
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const initial: Record<string, boolean> = {};
    columns.forEach((column) => {
      const columnId = column.id as string;
      initial[columnId] =
        column.enableHiding === false ||
        ((column.meta as CustomColumnMeta | undefined)?.isVisible ?? true);
    });
    return initial;
  });

  // Single, stable visibility setter shared by the Columns control and the
  // header "Hide column" menu -- `Cases.tsx`'s exact recipe: stable
  // (useCallback) so ColumnSelection's emit effect doesn't re-fire on every
  // render, and shallow-equal-guarded so an equal-but-new-reference map (the
  // two controls echoing each other) bails instead of looping.
  const handleColumnVisibilityChange = useCallback(
    (next: Record<string, boolean>) => {
      setColumnVisibility((prev) => {
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const key of keys) {
          if (prev[key] !== next[key]) return next;
        }
        return prev;
      });
    },
    []
  );

  // ColumnSelection assigns its "hide a column" function here; the header
  // "Hide column" menu calls it so a hide flows through the Columns control's
  // own state (persists + keeps its checkboxes in sync), never a table
  // round-trip -- the single-owner visibility rule.
  const columnHideRef = useRef<((columnId: string) => void) | null>(null);

  // Lightweight metadata for ColumnSelection (`Cases.tsx`'s convention). The
  // `actions` entry is appended UNCONDITIONALLY -- while `canAddEdit` is
  // still resolving AND for read-only viewers, who never get the real
  // column -- so ColumnSelection's own first/last-always-visible convention
  // lands on `actions`, never on the hidden-by-default `createdAt` that
  // would otherwise sit last and be forced visible. A stray `actions: true`
  // entry in the visibility map is inert when the column doesn't exist.
  const actionsColumnLabel = t("common.actions.actionsLabel");
  const columnMetadata: ColumnMetadata[] = useMemo(() => {
    const metadata: ColumnMetadata[] = columns
      .filter((column) => column.id !== "actions")
      .map((column) => ({
        id: column.id as string,
        label: typeof column.header === "string" ? column.header : "",
        isVisible: (column.meta as CustomColumnMeta | undefined)?.isVisible,
        enableHiding: column.enableHiding,
      }));
    metadata.push({
      id: "actions",
      label: actionsColumnLabel,
      enableHiding: false,
    });
    return metadata;
  }, [columns, actionsColumnLabel]);

  // Render states, in this exact order (D-04d fixes a real bug: the prior
  // spinner guard alone spun forever on a genuine fetch failure, because the
  // seeded array never resolves past its initial state once the fetch has
  // errored -- the error branch below must be checked first, independently).
  // Both modes reduce to the SAME expression the all-mode-only version used
  // `treeCountError` is its own term: a failed count leaves the list with no
  // total to measure against and nothing to retry, which the "no data yet"
  // spinner below would otherwise render as a permanent load.
  const hasLoadError =
    treeCountError ||
    (lazyLoadMoreError && lazyTreeRows.length === 0 && !lazyTreeLoading);

  if (hasLoadError) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center"
        data-testid="requirements-list-error"
      >
        <p className="text-sm text-destructive">
          {t("requirements.tree.loadFailed")}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshRequirements()}
        >
          {t("search.errors.tryAgain")}
        </Button>
      </div>
    );
  }

  const noDataYet = lazyTreeRows.length === 0 && lazyTreeLoading;

  // The full-view spinner is for the FIRST paint only. Every fetch after
  // that -- a filter keystroke, a sort, a mutation refetch -- clears the row
  // map while it runs, and returning a spinner here would unmount the whole
  // view INCLUDING the toolbar. The filter input would then be destroyed and
  // rebuilt mid-typing: a new DOM node, no focus, and the caret lost after
  // roughly every other keystroke.
  //
  // Tracked per project, so switching projects still gets its own first
  // paint. Assigning during render is safe because it is idempotent -- the
  // same value for the same render -- and nothing outside this component
  // observes it. Past the first paint the table stays mounted and shows its
  // own loading treatment through `isLoading` instead.
  if (!lazyTreeLoading) firstPaintDoneForProjectRef.current = projectId;
  const isFirstPaint = firstPaintDoneForProjectRef.current !== projectId;

  if ((showSpinner || noDataYet) && isFirstPaint) {
    return <LoadingSpinner />;
  }

  // Empty (zero requirements) and the table are the two remaining states,
  // rendered from the same return so the create/delete dialogs below mount
  // exactly once regardless of which one is showing -- their own `open`
  // state gates visibility either way.
  const isEmpty = (projectTotal ?? 0) === 0;

  // SCALE-03 (D-08): the matched-aware `x`/`y` pair the toolbar renders
  // verbatim, both sourced from the hook -- never re-derived from
  // `rows.length`, which counts ancestors and expanded children too.
  // Unfiltered: x = rows loaded, y = the project's classified total.
  // Filtered: x = loaded matches, y = the server's match total -- ancestors
  // are context, never counted (otherwise "Showing 24 of 20", the exact
  // symptom this arithmetic exists to avoid). `treeLoadedCount` already
  // carries this distinction for every mode (28-11's own contract:
  // unfiltered lazy = roots loaded; unfiltered all = the project total,
  // since this component already holds every row below the threshold;
  // filtered, either mode = loaded matches).
  const showingLoaded = treeLoadedCount;
  // Unfiltered, the denominator is the ROOT count, not every requirement:
  // the window can only ever load top-level rows, so counting nested
  // children here made a fully-loaded list read as stalled (operator UAT --
  // "463 of 516 and nothing more loads", where 463 was every root and the
  // other 53 were children behind an expand arrow).
  const showingTotal = treeIsFiltering
    ? (matchedTotal ?? 0)
    : (projectRootTotal ?? projectTotal ?? 0);

  return (
    <>
      {isEmpty ? (
        <div
          className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center"
          data-testid="requirements-tree-empty"
        >
          <p className="text-sm font-medium">
            {t("requirements.tree.emptyTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("requirements.tree.emptyDescription")}
          </p>
          {canAddEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              data-testid="requirements-tree-empty-add-root"
              onClick={() =>
                setCreateDialogState({
                  open: true,
                  parentId: null,
                  parentName: null,
                })
              }
            >
              <ClipboardPlus className="h-4 w-4" />
              {t("requirements.tree.addRoot")}
            </Button>
          )}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex h-full min-w-[220px] flex-col"
          data-testid="requirements-list-container"
        >
          <div className="my-1 ms-1 me-2 flex flex-wrap items-center justify-between gap-2">
            <div className="relative grow shrink basis-[120px] min-w-[120px] max-w-lg">
              <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setFilterQuery("");
                  }
                }}
                placeholder={t("requirements.tree.searchPlaceholder")}
                aria-label={t("requirements.tree.searchPlaceholder")}
                className="h-7 ps-7 pe-7 text-xs"
                data-testid="requirements-filter-input"
              />
              {isFiltering && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute end-0.5 top-1/2 h-6 w-6 -translate-y-1/2"
                  aria-label={t("common.aria.clearFilter")}
                  data-testid="requirements-filter-clear"
                  onClick={() => setFilterQuery("")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {/* Filters live in their own group so the row can justify the
                search input left and the whole filter set right
                (operator UAT). */}
            <div className="flex flex-wrap items-center gap-2">
              <RequirementsFilterCombobox
                testId="requirements-coverage-filter"
                label={t("milestones.members.filterAllCoverage")}
                options={coverageFilterOptions}
                selected={filters.coverage}
                disabled={coverageFilterUnavailable}
                title={
                  coverageFilterUnavailable
                    ? t("requirements.coverage.showOnlyUncoveredUnavailable")
                    : undefined
                }
                onChange={(next) =>
                  setFilters((prev) => ({
                    ...prev,
                    coverage: next as RequirementCoverageFilter[],
                  }))
                }
              />
              <RequirementsFilterCombobox
                testId="requirements-status-filter"
                label={t("requirements.list.filterAllStatuses")}
                options={statusFilterOptions}
                selected={filters.status}
                onChange={(next) =>
                  setFilters((prev) => ({ ...prev, status: next }))
                }
              />
              <RequirementsFilterCombobox
                testId="requirements-source-filter"
                label={t("milestones.members.filterAllSources")}
                options={sourceFilterOptions}
                selected={filters.source}
                onChange={(next) =>
                  setFilters((prev) => ({
                    ...prev,
                    source: next as RequirementSourceValue[],
                  }))
                }
              />
            </div>
          </div>
          {/* Its own row beneath the filters (operator UAT): the column
              picker on the left, the count on the right, and the count
              rendered unconditionally so the reader never has to wonder
              whether the list is showing everything. */}
          <div className="flex items-center justify-between gap-2 py-2 px-1">
            <ColumnSelection
              key="requirements-list-column-selection"
              storageKey={`requirements-list:${projectId}`}
              columns={columns as CustomColumnDef<RequirementRow>[]}
              columnMetadata={columnMetadata}
              hideColumnRef={columnHideRef}
              onVisibilityChange={handleColumnVisibilityChange}
            />
            <span
              className="whitespace-nowrap text-xs text-muted-foreground"
              data-testid="requirements-list-showing"
            >
              {t("common.pagination.showing")}{" "}
              {t("common.pagination.loadedOfTotal", {
                loaded: showingLoaded,
                total: showingTotal,
              })}
            </span>
          </div>
          <div
            ref={(el) => {
              listDropRef(el);
            }}
            className="relative min-h-0 flex-1"
          >
            <DataTable
              virtualized
              columns={columns as any}
              data={rows}
              onSortChange={handleSortChange}
              onSortColumn={handleSortColumn}
              onHideColumn={(columnId) => columnHideRef.current?.(columnId)}
              sortConfig={sortConfig}
              isLoading={lazyTreeLoading}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              // SCALE-02 (D-08): real infinite scroll -- the hook owns
              // `hasMore`/`onLoadMore`/`loadedCount` for every project size.
              hasMore={treeHasMore}
              onLoadMore={treeOnLoadMore}
              loadedCount={treeLoadedCount}
              loadMoreError={lazyLoadMoreError}
              onRetryLoadMore={treeOnRetryLoadMore}
              getRowId={(row) => String(row.id)}
              // 48 stays the estimate even with the two new case-count cells
              // (D-11b): the virtualizer measures every row's real height
              // dynamically, so an unchanged estimate costs at most one
              // frame of layout shift on first paint, never a correctness
              // issue, and these cells render at the same line-height as the
              // coverage cell they sit beside.
              estimateSize={48}
              columnSizingStorageKey="requirements-list-columns"
              // D-11c (operator may overrule at re-UAT): seven columns at
              // their natural summed width (~960px) exceed the list pane's
              // default 30%-of-window size, so `enableColumnPinning` (never
              // `flexColumnId`) moves horizontal scroll onto the table body
              // and keeps `actions` (already `meta: { isPinned: "right" }`)
              // frozen at the right edge -- matching MemberIssuesTable.tsx's
              // own proven configuration exactly. `flexColumnId` is REMOVED
              // rather than combined with pinning: a flex column stretched
              // to 100% alongside sticky column pinning is an untested
              // combination in VirtualizedTableEngine, and the only thing it
              // would buy back is trailing whitespace in a pane wide enough
              // to not need scrolling at all. Trade-off: in a very wide pane
              // the table now shows trailing space (never occupied by
              // `name`) until the user manually widens the `name` column,
              // which then persists via `columnSizingStorageKey` like every
              // other resize. `name` is deliberately NOT pinned left -- at
              // this pane's default width a 320px frozen first column would
              // leave almost nothing left to scroll, which was considered
              // and rejected, not merely overlooked.
              enableColumnPinning
              pinFirstLast={false}
              highlightRowId={selectedRequirementId}
              scrollToRowId={scrollToRequirementId}
              getRowProps={getRowProps}
              // This list flattens its own tree, so TanStack's `row.depth`
              // is 0 on every row -- the engine reads the real depth from
              // the row data instead, which is what makes a child row pick
              // up the shared nested-row surface (tinted fill + softened
              // dividers) every other nested table in the app already uses.
              getRowNestingDepth={(row) =>
                (row.original as RequirementRow).depth
              }
              // The guide itself is painted by the engine, not the name
              // cell: it has to reach the row's top and bottom borders, and
              // the engine wraps every cell's content in a `truncate` div
              // that clips to the height of its own text.
              getRowNestingGuideOffset={(row) =>
                requirementNestingGuideOffset(
                  (row.original as RequirementRow).depth
                )
              }
              emptyMessage={t("common.ui.search.noResultsFound")}
              // `debouncedSearch` (not `normalizedFilter`) so this resets in
              // the SAME render as the hook's own internal reset (keyed on
              // the debounced `treeFilters.search`) -- keying on the instant
              // value would reset the virtualizer a render ahead of the
              // data on every keystroke, one frame apart from the hook.
              resetKey={`${debouncedSearch}|${[...filters.coverage].sort().join(",")}|${[...filters.status].sort().join(",")}|${[...filters.source].sort().join(",")}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="requirements-list"
              rowTestIdPrefix="requirement-row"
            />
            {canAddEdit && !isFiltering && (
              <div
                ref={(el) => {
                  bottomDropRef(el);
                }}
                // `ROOT_STRIP_DRAG_CLASSNAME` is static -- always present,
                // never toggled by JS -- and only paints once `data-req-drag`
                // appears on the container above (pure CSS, gap closure
                // 26.2-16). `isOverBottom` below is unrelated: it comes from
                // this element's OWN `useDrop` collector, so only this single,
                // non-virtualized node re-renders on hover, never the row set.
                // Absolute overlay pinned to the BOTTOM OF THE LIST VIEWPORT
                // (the wrapper above), not a sibling below the full-height
                // layout -- as a sibling it sat below the fold whenever the
                // page scrolled (operator UAT, twice). `hidden` while idle via
                // the same drag attribute, so it never blocks clicks on the
                // rows it overlays and appears only while a drag is active.
                className={`absolute bottom-2 left-1/2 z-10 hidden h-11 w-auto min-w-[280px] max-w-[90%] -translate-x-1/2 [[data-req-drag=active]_&]:block ${isOverBottom ? ROOT_STRIP_OVER_CLASSNAME : ROOT_STRIP_DRAG_CLASSNAME}`}
                data-testid="requirement-tree-end"
              >
                {/* Always mounted; `hidden` by default, shown by the same
                  container attribute -- see the comment on
                  `ROOT_STRIP_HINT_CLASSNAME`'s declaration. The real-browser
                  drag check remains mandatory UAT: jsdom cannot assert
                  computed visibility here. */}
                <div
                  className={ROOT_STRIP_HINT_CLASSNAME}
                  data-testid="requirement-tree-end-hint"
                >
                  {t("requirements.tree.dropToRootHint")}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <CreateRequirementDialog
        projectId={projectId}
        parentId={createDialogState.parentId}
        parentName={createDialogState.parentName}
        open={createDialogState.open}
        onOpenChange={(nextOpen) =>
          setCreateDialogState((prev) => ({ ...prev, open: nextOpen }))
        }
        onCreated={(id) => {
          refreshRequirements();
          onSelectRequirement(id);
          invalidateCoverage();
        }}
      />
      {deleteDialogState.requirementId != null && (
        <DeleteRequirementModal
          projectId={projectId}
          requirementId={deleteDialogState.requirementId}
          descendantCount={modalDescendantCount}
          open={deleteDialogState.open}
          onOpenChange={(nextOpen) =>
            setDeleteDialogState((prev) => ({ ...prev, open: nextOpen }))
          }
          onDeleted={(deletedIds) => {
            refreshRequirements();
            invalidateCoverage();
            if (
              selectedRequirementId != null &&
              deletedIds.includes(selectedRequirementId)
            ) {
              onSelectRequirement(null);
            }
          }}
        />
      )}
    </>
  );
});

export default RequirementsListView;
