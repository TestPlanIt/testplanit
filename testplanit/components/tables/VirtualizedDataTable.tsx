"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes TanStack Table / TanStack Virtual APIs that return unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it (same as components/matrix/MatrixGrid.tsx and hooks/useVirtualizedInfiniteList.ts). */

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Column,
  ColumnDef,
  ColumnPinningState,
  ColumnSizingState,
  ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  OnChangeFn,
  Row,
  RowSelectionState,
  SortingState,
  Updater,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDownAZ,
  ArrowDownUp,
  ArrowUpZA,
  Group,
  UnfoldVertical,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizedInfiniteList } from "~/hooks/useVirtualizedInfiniteList";
import { cn } from "~/utils";
import { tableStyles } from "./tableStyles";

/**
 * Sticky-column CSS for a pinned column, mirroring `DataTable`'s
 * `getCommonPinningStyles`. Only applied when the caller opts in via
 * `enableColumnPinning`; returns `{}` for unpinned columns. The pinned cell
 * also needs an opaque background (applied via className) so horizontally
 * scrolled content doesn't bleed through.
 */
function getPinningStyles(column: Column<any, any>): CSSProperties {
  const isPinned = column.getIsPinned();
  if (!isPinned) return {};
  const isLastLeftPinned =
    isPinned === "left" && column.getIsLastColumn("left");
  const isFirstRightPinned =
    isPinned === "right" && column.getIsFirstColumn("right");
  return {
    position: "sticky",
    left: isPinned === "left" ? column.getStart("left") : undefined,
    right: isPinned === "right" ? column.getStart("right") : undefined,
    zIndex: 2,
    boxShadow: isLastLeftPinned
      ? "4px 0 8px -4px rgba(0,0,0,0.3)"
      : isFirstRightPinned
        ? "-4px 0 8px -4px rgba(0,0,0,0.3)"
        : undefined,
  };
}

/**
 * Virtualized, infinite-scrolling table.
 *
 * A lighter-weight alternative to the shared `DataTable` for surfaces that need
 * to render an arbitrarily large result set as one continuous, page-seam-free
 * list. It supports draggable column resizing (live, and optionally persisted
 * per user via `columnSizingStorageKey`) and opt-in column pinning
 * (`enableColumnPinning`, off by default), but not `DataTable`'s drag-reorder;
 * it keeps the table features that scroll well (sorting, grouping, expansion,
 * sub-rows, column visibility) by driving a TanStack `useReactTable` instance
 * and rendering its flattened row model (`getRowModel().rows`) through
 * `useVirtualizedInfiniteList`.
 *
 * Consumed by the reports results panel and the admin audit-log table; both
 * converge on the same scroll model. Per-surface chrome (empty-state copy,
 * test-id prefixes) is parameterized.
 *
 * Layout: an outer horizontal-scroll container holds a flex column whose width
 * is the summed column width; a non-scrolling header row sits on top and a
 * vertical-scroll body (the virtualizer's scroll element) holds the rows. Both
 * header and body size every cell from `column.getSize()`, so they stay aligned
 * while the whole table scrolls horizontally as a unit.
 *
 * Pagination modes:
 *   - Full-set: caller passes the entire array with `hasMore=false`; the list
 *     virtualizes it.
 *   - Fetch-on-scroll: caller supplies `hasMore`/`isLoading`/`onLoadMore`; the
 *     sentinel pulls and the caller appends.
 */

const EXPANDER_WIDTH = 24;
const ESTIMATED_ROW_HEIGHT = 44;

/**
 * Header label that surfaces a native tooltip with the column's full text, but
 * only while that text is actually clipped by the column's width. Works for any
 * header content (a plain string or a render function with icons) by reading the
 * rendered `textContent`, and re-measures on column resize via a ResizeObserver
 * so the tooltip appears/disappears live as the user drags the column narrower
 * or wider.
 */
function TruncatedHeaderLabel({ children }: { children: ReactNode }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [title, setTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    const measure = () => {
      const isClipped = el.scrollWidth > el.clientWidth;
      setTitle(isClipped ? el.textContent?.trim() || undefined : undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  return (
    <span ref={spanRef} title={title} className="min-w-0 truncate">
      {children}
    </span>
  );
}

interface VirtualizedDataTableProps {
  columns: ColumnDef<any, any>[];
  data: any[];

  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (visibility: VisibilityState) => void;

  sortConfig?: { column: string; direction: "asc" | "desc" } | null;
  onSortChange?: (columnId: string) => void;

  grouping?: string[];
  onGroupingChange?: OnChangeFn<string[]>;
  expanded?: ExpandedState;
  onExpandedChange?: OnChangeFn<ExpandedState>;

  getSubRows?: (row: any, index: number) => any[] | undefined;
  subRowsLabel?: string;

  /**
   * Controlled row-selection state (keyed by row index, TanStack's default), for
   * surfaces with a checkbox column that reads `row.getIsSelected()`. When
   * provided, row selection is enabled and driven by the caller; omit it and the
   * table has no selection behavior. Note the keys are row indices into `data`,
   * so the caller must pass the full (unpaged) set — which a virtualized table
   * already does.
   */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Stable row identity for selection state — without it TanStack keys
   * selection by row INDEX, which silently re-targets selections when the
   * data is filtered or re-sorted. */
  getRowId?: (originalRow: any, index: number) => string;

  /**
   * Id of a column that should flex to absorb any horizontal space left over
   * once the other (fixed-width) columns are laid out — so a table wider than
   * its content doesn't leave a gap after the last column. The column never
   * shrinks below its declared `size`; when the content is wider than the
   * viewport the table falls back to horizontal scroll.
   */
  flexColumnId?: string;

  /**
   * Frozen/pinned columns. On by default: with no explicit config the first and
   * last columns freeze to the table edges and stay put during horizontal
   * scroll (row identity + actions always visible), via a synced-scroll layout
   * (the body scrolls horizontally and a header viewport mirrors it) so
   * `position: sticky` actually sticks. Declare `meta: { isPinned: "left" |
   * "right" }` on columns to pin an exact set instead (that replaces the
   * first/last default). Pass `false` to turn pinning off entirely.
   */
  enableColumnPinning?: boolean;

  /**
   * Whether the first and last columns freeze automatically (only applies when
   * the caller pinned nothing via `meta.isPinned`). Defaults to true; pass false
   * to keep pinning available for explicit `meta.isPinned` columns without the
   * automatic first/last freeze.
   */
  pinFirstLast?: boolean;

  /**
   * Extra inline style for pinned BODY cells, merged over the sticky
   * positioning. Use it to override the default opaque background so pinned
   * columns match a tinted surface — e.g. a completed-milestone card, where the
   * default white/muted fills would otherwise clash. Only applied to pinned
   * cells when `enableColumnPinning` is on.
   */
  pinnedColumnStyle?: CSSProperties;

  /**
   * Extra inline style for pinned HEADER cells specifically. The header row
   * carries its own translucent `bg-muted-foreground/20` strip, so over a tinted
   * surface it renders a shade darker than the body; a pinned header therefore
   * needs a different opaque fill than a pinned body cell to match. Falls back to
   * `pinnedColumnStyle` when omitted.
   */
  pinnedHeaderStyle?: CSSProperties;

  /**
   * When set, resized column widths are persisted per user to localStorage under
   * this key (scope it per surface, e.g. per report type). Column resizing is
   * always enabled regardless; without a key the widths just reset on remount.
   */
  columnSizingStorageKey?: string;

  // Infinite scroll (defaults keep the table in full-set / client mode).
  hasMore?: boolean;
  isLoading?: boolean;
  onLoadMore?: () => void;
  loadMoreError?: boolean;
  onRetryLoadMore?: () => void;
  /**
   * Override for the load-more "a page landed" signal. By default this is
   * derived automatically from the table's full pre-expansion row model (every
   * rolled-up child counted, whether or not its parent is expanded), so ANY
   * rollup table — rows collapsed into parents via `getSubRows`, or grouped via
   * `grouping` — keeps paginating even when a whole fetched page collapses into
   * an already-present parent and the visible row count doesn't grow. Only pass
   * this when the true loaded count can't be derived from `data` (e.g. a parent
   * whose children are lazy-loaded from the server and aren't present in `data`).
   */
  loadedCount?: number;

  /**
   * Shown when the result set is empty and not loading. Defaults to the generic
   * "no results" label so consumers only override when they want surface copy.
   */
  emptyMessage?: ReactNode;
  /**
   * Extra signal folded into the scroll/measure reset key. The table already
   * resets on sort / grouping / column-set changes; pass this when the result
   * set identity also changes for reasons the table can't see (e.g. external
   * filters) so the scroll returns to the top on those changes too.
   */
  resetKey?: unknown;
  /**
   * Estimated row height in px. The virtualizer measures real heights once rows
   * render, but a close estimate keeps the pre-measure layout stable — which
   * matters for the load-more trigger, since a big under-estimate makes rows
   * grow after measurement and can otherwise shove the trigger point around.
   * Set this to roughly a surface's real row height when rows are taller than
   * the single-line default (e.g. issue rows carrying a title + description).
   */
  estimateSize?: number;
  /**
   * Size the scroll body to fill from its own top edge down to the viewport
   * bottom (measured live), instead of inheriting a bounded height from the
   * parent. Use this when the table is the main content of a page whose header
   * height varies — it always yields a single inner scroll region regardless of
   * how tall the header/nav above it is, so the page body never scrolls (which
   * would otherwise starve the virtualizer's load-more trigger of scroll
   * events). When false (default) the caller must give the table a bounded-height
   * container (e.g. `h-[calc(100vh-20rem)]` or a flex `min-h-0` parent).
   */
  fillViewport?: boolean;
  /**
   * When set, the table scrolls the row whose `original.id` matches this id into
   * view (centered) once it appears in the row model. Used for deep links (e.g.
   * `?issueId=`) — the caller loads the full set so the target is present, then
   * passes its id here; the virtualizer scrolls to it even though its DOM row
   * isn't rendered until it's near the window. Fires once per id value.
   */
  scrollToRowId?: string | number | null;
  /**
   * When set, the row whose `original.id` matches is drawn with a persistent
   * highlight ring. Pair with `scrollToRowId` so a deep-linked row is both
   * scrolled to and visually marked; the caller clears it (e.g. on user scroll)
   * when the highlight should fade.
   */
  highlightRowId?: string | number | null;
  testIdPrefix?: string;
  rowTestIdPrefix?: string;
}

export function VirtualizedDataTable({
  columns,
  data,
  columnVisibility,
  onColumnVisibilityChange,
  sortConfig,
  onSortChange,
  grouping,
  onGroupingChange,
  expanded,
  onExpandedChange,
  getSubRows,
  subRowsLabel,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  flexColumnId,
  enableColumnPinning = true,
  pinFirstLast = true,
  pinnedColumnStyle,
  pinnedHeaderStyle,
  columnSizingStorageKey,
  hasMore = false,
  isLoading = false,
  onLoadMore,
  loadMoreError = false,
  onRetryLoadMore,
  loadedCount,
  emptyMessage,
  resetKey: externalResetKey,
  estimateSize = ESTIMATED_ROW_HEIGHT,
  fillViewport = false,
  scrollToRowId,
  highlightRowId,
  testIdPrefix = "virtualized-table",
  rowTestIdPrefix = "virtualized-row",
}: VirtualizedDataTableProps) {
  const t = useTranslations("common.table");
  const tActions = useTranslations("common.actions");
  const tLabels = useTranslations("common.labels");
  const tAria = useTranslations("common.aria");
  const tErrors = useTranslations("search.errors");

  // Convert the caller's sortConfig into TanStack's controlled sorting state,
  // ignoring a stale sort that points at a column the current set lacks
  // (mirrors DataTable's guard).
  const sorting: SortingState = useMemo(() => {
    if (!sortConfig) return [];
    if (!columns.some((c) => c.id === sortConfig.column)) return [];
    return [{ id: sortConfig.column, desc: sortConfig.direction === "desc" }];
  }, [sortConfig, columns]);

  const handleSortingChange = useCallback(
    (updaterOrValue: Updater<SortingState>) => {
      if (!onSortChange) return;
      const next =
        typeof updaterOrValue === "function"
          ? updaterOrValue(sorting)
          : updaterOrValue;
      if (next.length > 0) onSortChange(next[0].id);
    },
    [onSortChange, sorting]
  );

  const handleVisibilityChange = useCallback(
    (updaterOrValue: Updater<VisibilityState>) => {
      const next =
        typeof updaterOrValue === "function"
          ? updaterOrValue(columnVisibility)
          : updaterOrValue;
      onColumnVisibilityChange(next);
    },
    [columnVisibility, onColumnVisibilityChange]
  );

  // Draggable column widths. TanStack owns the live width during a drag (via
  // column.getSize(), which both header and body cells already read); we only
  // seed it from and flush it back to localStorage when a storage key is given.
  // Persist column widths under an explicit key, or fall back to the table's
  // `testIdPrefix` (unique per surface) so every table remembers its widths
  // without each caller wiring a separate key. The shared default prefix opts
  // out, so a table with neither an explicit key nor a real testIdPrefix stays
  // stateless.
  const effectiveColumnSizingKey =
    columnSizingStorageKey ??
    (testIdPrefix && testIdPrefix !== "virtualized-table"
      ? testIdPrefix
      : undefined);
  const columnSizingStorage = effectiveColumnSizingKey
    ? `vdt:colsize:${effectiveColumnSizingKey}`
    : null;
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    if (!columnSizingStorage || typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(columnSizingStorage);
      return raw ? (JSON.parse(raw) as ColumnSizingState) : {};
    } catch {
      return {};
    }
  });

  // Column pinning. Seed the left/right pin sets once, then let TanStack own the
  // state. First, honor any explicit `meta.isPinned`. When the caller pinned
  // nothing, default to freezing the first and last columns (the auto-added
  // expander rides along on the left so it doesn't scroll out from under the
  // pinned first column). Mirrors DataTable's explicit path.
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({
    left: [],
    right: [],
  });
  const initialPinningDone = useRef(false);
  useEffect(() => {
    if (!enableColumnPinning || initialPinningDone.current) return;
    const left: string[] = [];
    const right: string[] = [];
    for (const column of columns) {
      const pin = (column.meta as { isPinned?: "left" | "right" } | undefined)
        ?.isPinned;
      const id = column.id as string;
      if (pin === "left") left.push(id);
      else if (pin === "right") right.push(id);
    }
    if (
      pinFirstLast &&
      left.length === 0 &&
      right.length === 0 &&
      columns.length > 1
    ) {
      const firstId = columns[0]?.id as string | undefined;
      const lastId = columns[columns.length - 1]?.id as string | undefined;
      const hasExpander = !!(grouping && grouping.length > 0) || !!getSubRows;
      if (firstId) left.push(firstId);
      if (hasExpander) left.unshift("expander");
      if (lastId && lastId !== firstId) right.push(lastId);
    }
    setColumnPinning({ left, right });
    initialPinningDone.current = true;
  }, [enableColumnPinning, pinFirstLast, columns, grouping, getSubRows]);

  // In pinning mode the body scrolls horizontally; this ref lets the header
  // viewport mirror the body's scrollLeft so the columns stay aligned.
  const headerScrollRef = useRef<HTMLDivElement>(null);

  // Prepend an expander column when rows can nest (grouping or sub-rows).
  const expanderColumn: ColumnDef<any, any> = useMemo(
    () => ({
      id: "expander",
      header: () => null,
      cell: ({ row }: { row: Row<any> }) => {
        if (!row.getCanExpand()) return null;
        const isExpanded = row.getIsExpanded();
        const subRowsCount = row.subRows?.length ?? 0;
        const label = isExpanded
          ? tActions("collapse")
          : `${tActions("expand")}${
              subRowsLabel && subRowsCount > 0
                ? ` • ${subRowsCount} ${subRowsLabel}`
                : ""
            }`;
        return (
          <button
            onClick={row.getToggleExpandedHandler()}
            className="inline-flex w-4 items-center justify-center"
            aria-label={label}
            title={label}
          >
            <span
              className="inline-block transition-transform duration-200"
              style={{
                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              {"▶"}
            </span>
          </button>
        );
      },
      size: EXPANDER_WIDTH,
      minSize: EXPANDER_WIDTH,
      maxSize: EXPANDER_WIDTH,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
    }),
    [tActions, subRowsLabel]
  );

  const groupingActive = !!(grouping && grouping.length > 0);
  const finalColumns = useMemo(
    () =>
      groupingActive || getSubRows ? [expanderColumn, ...columns] : columns,
    [groupingActive, getSubRows, expanderColumn, columns]
  );

  const table = useReactTable({
    data,
    columns: finalColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: groupingActive ? getGroupedRowModel() : undefined,
    getExpandedRowModel:
      groupingActive || getSubRows ? getExpandedRowModel() : undefined,
    getSubRows,
    enableSorting: true,
    enableColumnResizing: true,
    enableColumnPinning,
    enableRowSelection: rowSelection !== undefined,
    ...(getRowId ? { getRowId } : {}),
    columnResizeMode: "onChange",
    state: {
      columnVisibility,
      sorting,
      columnSizing,
      ...(enableColumnPinning && { columnPinning }),
      ...(rowSelection !== undefined && { rowSelection }),
      ...(grouping !== undefined && { grouping }),
      ...(expanded !== undefined && { expanded }),
    },
    ...(enableColumnPinning && { onColumnPinningChange: setColumnPinning }),
    ...(onGroupingChange !== undefined && { onGroupingChange }),
    ...(onExpandedChange !== undefined && { onExpandedChange }),
    ...(onRowSelectionChange !== undefined && { onRowSelectionChange }),
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: handleVisibilityChange,
    onColumnSizingChange: setColumnSizing,
    defaultColumn: { minSize: 50, maxSize: 1500, size: 150 },
  });

  // Flush widths to storage when a resize gesture settles — writing on every
  // onChange tick would hammer localStorage. `isResizingColumn` is the dragged
  // column id while active and false once released.
  const isResizingColumn = table.getState().columnSizingInfo.isResizingColumn;
  const wasResizingRef = useRef<string | false>(false);
  useEffect(() => {
    if (wasResizingRef.current && !isResizingColumn && columnSizingStorage) {
      try {
        window.localStorage.setItem(
          columnSizingStorage,
          JSON.stringify(columnSizing)
        );
      } catch {
        // storage unavailable / over quota — keep the widths for this session
      }
    }
    wasResizingRef.current = isResizingColumn;
  }, [isResizingColumn, columnSizing, columnSizingStorage]);

  const rows = table.getRowModel().rows;
  // The load-more guard keys on this, not on `rows.length`: the visible row
  // count collapses rolled-up children away, so a whole fetched page can land
  // without it changing (a giant collapsed parent group), stalling pagination.
  // `getCoreRowModel().flatRows` counts EVERY row in the tree — parents and all
  // their (collapsed or expanded) children — so it grows on every page. For a
  // plain, non-rollup table it equals the visible count, so behaviour there is
  // unchanged. An explicit `loadedCount` prop still wins for server-lazy trees.
  const loadedRowCount = loadedCount ?? table.getCoreRowModel().flatRows.length;
  const leafColumns = table.getVisibleLeafColumns();
  const totalWidth = leafColumns.reduce((sum, c) => sum + c.getSize(), 0);

  // When a flex column is configured, the table stretches to fill its container
  // (and the flex column soaks up the slack) instead of sitting at its natural
  // content width with empty space trailing the last column.
  const hasFlex =
    !!flexColumnId && leafColumns.some((c) => c.id === flexColumnId);
  const tableWidth = hasFlex ? "100%" : totalWidth;
  // With a flex column the full-width layers stretch to "100%" so the flex
  // column soaks up slack — but a resized fixed column can still push the
  // summed column width past the container. Floor those layers at that summed
  // width so the header fill and row surfaces span the whole horizontally
  // scrolled content; otherwise they stop at the container edge and leave a
  // bare gap before the right-pinned column once the body is scrolled right.
  const flexMinWidth = hasFlex ? totalWidth : undefined;

  // Reset scroll + measurements when the *result set identity* changes (sort,
  // grouping, the column set, or a caller-supplied external signal such as a
  // filter) — but NOT when a page is appended (that would defeat infinite
  // scroll).
  const resetKey = useMemo(
    () =>
      JSON.stringify({
        sort: sortConfig ?? null,
        grouping: grouping ?? null,
        cols: columns.map((c) => c.id),
        external: externalResetKey ?? null,
      }),
    [sortConfig, grouping, columns, externalResetKey]
  );

  const {
    scrollRef,
    sentinelRef,
    virtualizer,
    virtualItems,
    totalSize,
    measureElement,
    maxHeight,
  } = useVirtualizedInfiniteList({
    count: rows.length,
    loadedCount: loadedRowCount,
    estimateSize,
    overscan: 8,
    hasMore,
    isLoading,
    onLoadMore: onLoadMore ?? (() => {}),
    boundToViewport: fillViewport,
    resetKey,
  });

  // Deep-link scroll: once the target row is present in the row model, scroll
  // the virtualizer to it (centered). Guarded so it fires once per id value —
  // re-running on every `rows` change (each appended page) would keep yanking
  // the scroll position back. The virtualizer scrolls by estimated offset even
  // though the row's DOM node isn't rendered until it's near the window.
  const scrolledToRef = useRef<string | number | null | undefined>(undefined);
  useEffect(() => {
    if (scrollToRowId == null) return;
    if (scrolledToRef.current === scrollToRowId) return;
    const index = rows.findIndex(
      (r) => String(r.original?.id) === String(scrollToRowId)
    );
    if (index < 0) return;
    scrolledToRef.current = scrollToRowId;
    virtualizer.scrollToIndex(index, { align: "center" });
  }, [scrollToRowId, rows, virtualizer]);

  const headers = table.getHeaderGroups().at(-1)?.headers ?? [];

  return (
    <div
      className={cn(
        "rounded-lg border-2 border-primary/10",
        // Pinning mode moves horizontal scroll onto the body (so sticky columns
        // can stick); otherwise the whole table scrolls horizontally here.
        enableColumnPinning ? "overflow-hidden" : "overflow-x-auto",
        !fillViewport && "h-full"
      )}
      role="table"
      data-testid={testIdPrefix}
    >
      <div
        className={cn("flex min-h-0 flex-col", !fillViewport && "h-full")}
        style={
          enableColumnPinning
            ? { width: "100%", minWidth: "100%" }
            : { width: tableWidth, minWidth: hasFlex ? totalWidth : "100%" }
        }
      >
        {/* Header — stays put vertically (lives above the scroll body). In
            pinning mode it's wrapped in an overflow-hidden viewport whose
            scrollLeft mirrors the body (see onScroll below); otherwise it
            scrolls horizontally with the body via the outer container. The
            muted fill is translucent so it overlays (rather than masks) the
            container's background, letting a tinted card — e.g. a
            completed-milestone card — show through. */}
        <div
          ref={enableColumnPinning ? headerScrollRef : undefined}
          className={cn("shrink-0", enableColumnPinning && "overflow-hidden")}
        >
          <div
            className={cn("flex", tableStyles.headerRow)}
            role="row"
            style={
              enableColumnPinning
                ? { width: tableWidth, minWidth: flexMinWidth }
                : undefined
            }
          >
            {headers
              .filter((header) => header.column.getIsVisible())
              .map((header) => {
                const { column } = header;
                const isSortable = column.columnDef.enableSorting !== false;
                const isActiveSort = sortConfig?.column === column.id;
                const direction = isActiveSort
                  ? sortConfig?.direction
                  : undefined;
                const isFlex = hasFlex && column.id === flexColumnId;
                return (
                  <div
                    key={header.id}
                    role="columnheader"
                    className={cn(
                      "relative flex select-none items-center gap-1 border-e px-3 last:border-e-0",
                      tableStyles.headerCell,
                      isFlex ? "min-w-0" : "shrink-0",
                      // Opaque fill so scrolled header cells don't bleed under a
                      // pinned one.
                      enableColumnPinning && column.getIsPinned() && "bg-muted"
                    )}
                    style={{
                      ...(isFlex
                        ? { flex: "1 1 0%", minWidth: column.getSize() }
                        : { width: column.getSize() }),
                      ...(enableColumnPinning ? getPinningStyles(column) : {}),
                      ...(enableColumnPinning && column.getIsPinned()
                        ? (pinnedHeaderStyle ?? pinnedColumnStyle ?? {})
                        : {}),
                    }}
                  >
                    {column.getCanGroup() && onGroupingChange ? (
                      <button
                        onClick={column.getToggleGroupingHandler()}
                        className="me-1"
                        aria-label={
                          column.getIsGrouped()
                            ? tAria("grouped")
                            : tAria("group")
                        }
                        title={
                          column.getIsGrouped()
                            ? tAria("grouped")
                            : tAria("group")
                        }
                      >
                        {column.getIsGrouped() ? (
                          <UnfoldVertical className="h-4 w-4" />
                        ) : (
                          <Group className="h-4 w-4" />
                        )}
                      </button>
                    ) : null}
                    <TruncatedHeaderLabel>
                      {flexRender(column.columnDef.header, header.getContext())}
                    </TruncatedHeaderLabel>
                    {isSortable && column.id !== "expander" && (
                      <button
                        onClick={() => onSortChange?.(column.id)}
                        className="ms-1 shrink-0 cursor-pointer"
                        aria-label={t("sort")}
                      >
                        {isActiveSort && direction === "asc" ? (
                          <ArrowDownAZ className="h-4 w-4" />
                        ) : isActiveSort && direction === "desc" ? (
                          <ArrowUpZA className="h-4 w-4" />
                        ) : (
                          <ArrowDownUp className="h-4 w-4 opacity-50" />
                        )}
                      </button>
                    )}
                    {/* Drag-to-resize handle on the column's right edge. The flex
                      column absorbs slack (no fixed width to drag) and the
                      expander column opts out via enableResizing:false. */}
                    {column.getCanResize() && !isFlex && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => column.resetSize()}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={t("resize")}
                        title={t("resize")}
                        className={cn(
                          "absolute end-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none transition-colors hover:bg-primary/40",
                          column.getIsResizing()
                            ? "bg-primary"
                            : "bg-transparent"
                        )}
                        data-testid={`${testIdPrefix}-resize-${column.id}`}
                      />
                    )}
                  </div>
                );
              })}
          </div>
        </div>

        {/* Body — the virtualizer's scroll element. CSS-bounded height
            (flex-1) so it works inside a bounded panel or card. In pinning mode
            it also owns horizontal scroll and mirrors scrollLeft to the header
            viewport so the frozen columns and headers stay aligned. */}
        <div
          ref={scrollRef}
          className={cn(
            "relative min-h-0",
            enableColumnPinning
              ? "overflow-auto"
              : "overflow-y-auto overflow-x-hidden",
            !fillViewport && "flex-1"
          )}
          onScroll={
            enableColumnPinning
              ? (e) => {
                  if (headerScrollRef.current) {
                    headerScrollRef.current.scrollLeft =
                      e.currentTarget.scrollLeft;
                  }
                }
              : undefined
          }
          style={
            fillViewport
              ? { height: maxHeight ?? undefined, minHeight: 200 }
              : undefined
          }
          data-testid={`${testIdPrefix}-scroll`}
        >
          {rows.length === 0 && !isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {emptyMessage ?? tLabels("noResults")}
            </div>
          ) : (
            <div
              className="relative"
              style={{
                height: totalSize,
                width: tableWidth,
                minWidth: flexMinWidth,
              }}
            >
              {virtualItems.map((vItem) => {
                const row = rows[vItem.index];
                if (!row) return null;
                const isGrouped = row.getIsGrouped();
                const isSubRow = row.depth > 0;
                const isHighlighted =
                  highlightRowId != null &&
                  String(row.original?.id) === String(highlightRowId);
                return (
                  <div
                    // Key by the virtual item (index), not the data id, so React
                    // reuses DOM nodes by position to match TanStack Virtual's
                    // index-based dynamic measurement — otherwise some rows stick
                    // at estimateSize and the row heights come out uneven.
                    key={vItem.key}
                    data-index={vItem.index}
                    ref={measureElement}
                    role="row"
                    data-row-id={row.original?.id}
                    data-testid={`${rowTestIdPrefix}-${row.original?.id ?? vItem.index}`}
                    className={cn(
                      "absolute start-0 top-0 flex border-b",
                      tableStyles.rowDivider,
                      isGrouped
                        ? "bg-accent font-semibold text-foreground"
                        : isSubRow
                          ? // Nested detail rows: a shaded block (the colored nesting
                            // bar is drawn on the right edge of the first/indent cell
                            // below) so the run of sub-rows reads as one group and the
                            // next (lighter) parent row is clearly the boundary.
                            tableStyles.rowSurfaceNested
                          : tableStyles.rowSurface,
                      isHighlighted &&
                        "bg-primary/10 outline outline-4 -outline-offset-2 outline-primary"
                    )}
                    style={{
                      width: tableWidth,
                      minWidth: flexMinWidth,
                      transform: `translateY(${vItem.start}px)`,
                    }}
                  >
                    {row.getVisibleCells().map((cell, cellIndex) => {
                      const { column } = cell;
                      let content: ReactNode;
                      if (groupingActive && cell.getIsGrouped()) {
                        const showCount = !column.columnDef.aggregatedCell;
                        content = (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={row.getToggleExpandedHandler()}
                              className="me-1 p-1"
                              aria-label={
                                row.getIsExpanded()
                                  ? tActions("collapse")
                                  : tActions("expand")
                              }
                            >
                              <span
                                className="inline-block transition-transform duration-200"
                                style={{
                                  transform: row.getIsExpanded()
                                    ? "rotate(90deg)"
                                    : "rotate(0deg)",
                                }}
                              >
                                {"▶"}
                              </span>
                            </button>
                            {flexRender(
                              column.columnDef.cell,
                              cell.getContext()
                            )}
                            {showCount ? ` (${row.subRows.length})` : null}
                          </div>
                        );
                      } else if (groupingActive && cell.getIsAggregated()) {
                        content = flexRender(
                          column.columnDef.aggregatedCell ??
                            column.columnDef.cell,
                          cell.getContext()
                        );
                      } else if (groupingActive && cell.getIsPlaceholder()) {
                        content = null;
                      } else {
                        content = flexRender(
                          column.columnDef.cell,
                          cell.getContext()
                        );
                      }
                      const isFlex = hasFlex && column.id === flexColumnId;
                      // Cells truncate to a single line by default so long raw
                      // text doesn't wrap and grow the row — the user widens the
                      // column to see more. A column opts out with
                      // `meta: { wrap: true }`.
                      const wrap = (
                        column.columnDef.meta as { wrap?: boolean } | undefined
                      )?.wrap;
                      return (
                        <div
                          key={column.id}
                          role="cell"
                          data-column-id={String(column.id)}
                          className={cn(
                            "flex min-w-0 items-center overflow-hidden border-e px-3 last:border-e-0",
                            tableStyles.cell,
                            !isFlex && "shrink-0",
                            // Opaque fill so scrolled cells don't bleed under a
                            // pinned column. Matches the row surface so the
                            // pinned column reads as part of its row.
                            enableColumnPinning &&
                              column.getIsPinned() &&
                              (isSubRow
                                ? "table-row-surface-nested"
                                : "table-row-surface"),
                            // Nesting guide: a wide colored bar on the RIGHT edge of
                            // the first (indent) cell of a sub-row, marking where the
                            // nested content begins.
                            isSubRow &&
                              cellIndex === 0 &&
                              "border-e-4 border-e-primary"
                          )}
                          style={{
                            ...(isFlex
                              ? { flex: "1 1 0%", minWidth: column.getSize() }
                              : { width: column.getSize() }),
                            ...(enableColumnPinning
                              ? getPinningStyles(column)
                              : {}),
                            ...(enableColumnPinning &&
                            column.getIsPinned() &&
                            pinnedColumnStyle
                              ? pinnedColumnStyle
                              : {}),
                          }}
                        >
                          {wrap ? (
                            content
                          ) : (
                            <div className="min-w-0 flex-1 truncate">
                              {content}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {/* Sentinel — when it nears the viewport and there's more, the hook
              fetches the next page (fetch-on-scroll mode only). */}
          <div
            ref={sentinelRef}
            aria-hidden
            className="h-px w-full"
            data-testid={`${testIdPrefix}-sentinel`}
          />

          {isLoading && data.length > 0 && (
            <div
              className="space-y-2 px-3 py-3"
              data-testid={`${testIdPrefix}-loading-more`}
            >
              <Skeleton className="h-8 w-full" />
            </div>
          )}

          {loadMoreError && (
            <div className="py-4 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={onRetryLoadMore}
                data-testid={`${testIdPrefix}-load-more-retry`}
              >
                {tErrors("tryAgain")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
