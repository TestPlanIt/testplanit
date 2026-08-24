"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes TanStack Table / TanStack Virtual APIs that return unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it (same as components/matrix/MatrixGrid.tsx and hooks/useVirtualizedInfiniteList.ts). */

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { closestCenter, DndContext } from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ColumnDef,
  ColumnSizingState,
  ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  OnChangeFn,
  Row,
  RowSelectionState,
  Updater,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDownAZ,
  ArrowDownUp,
  ArrowUpZA,
  ChevronDown,
  GripVertical,
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
import { flushSync } from "react-dom";
import { useVirtualizedInfiniteList } from "~/hooks/useVirtualizedInfiniteList";
import { cn } from "~/utils";
import {
  ColumnMenuItems,
  type CustomColumnMeta,
  type SortConfig,
  getFlexPinningStyles,
  resolveGroupableCellContent,
  TruncatedHeaderLabel,
  useExpanderColumn,
  useInitialColumnPinning,
  usePersistedColumnOrder,
  useSortingAdapter,
} from "./dataTableShared";
import { tableStyles } from "./tableStyles";

/**
 * The virtualized, infinite-scrolling render engine behind `DataTable`'s
 * `virtualized` mode. Not part of the public API — consumers render
 * `<DataTable virtualized ... />`.
 *
 * Renders an arbitrarily large result set as one continuous, page-seam-free
 * list. It supports draggable column resizing (live, and optionally persisted
 * per user via `columnSizingStorageKey`), opt-in column pinning
 * (`enableColumnPinning`, on by default), and drag-to-reorder of non-pinned
 * columns (grip handles; order persisted under the same key as widths); it
 * keeps the table features that scroll well (sorting, grouping, expansion,
 * sub-rows, column visibility) by driving a TanStack `useReactTable` instance
 * and rendering its flattened row model (`getRowModel().rows`) through
 * `useVirtualizedInfiniteList`.
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

const ESTIMATED_ROW_HEIGHT = 44;

/**
 * Render-prop shell that makes one flex header cell drag-reorderable. The cell
 * div is the sortable node (so it slides during a drag) but only the grip
 * carries the drag listeners — sort clicks and the resize handle keep working,
 * and the 5px pointer-activation constraint means a click never starts a drag.
 * Rendered for every header while reordering is on; `disabled` (pinned columns
 * and the expander) keeps the hook mounted but inert, so hook order is stable
 * across pinning changes.
 */
function SortableHeaderShell({
  id,
  disabled,
  reorderLabel,
  children,
}: {
  id: string;
  disabled: boolean;
  reorderLabel: string;
  children: (shell: {
    setNodeRef?: (node: HTMLElement | null) => void;
    dragStyle: CSSProperties;
    grip: ReactNode;
  }) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  if (disabled) {
    return <>{children({ dragStyle: {}, grip: null })}</>;
  }
  const dragStyle: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : undefined,
    zIndex: isDragging ? 3 : undefined,
  };
  const grip = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      aria-label={reorderLabel}
      className="me-1 shrink-0 cursor-grab touch-none text-muted-foreground/50 hover:text-foreground active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return <>{children({ setNodeRef, dragStyle, grip })}</>;
}

/**
 * Inert DOM props a consumer can attach to a virtualized row's outer element
 * via `getRowProps`. Deliberately has NO `ref` member — see `getRowProps`'s
 * own doc comment for why.
 */
export interface VirtualizedRowExtraProps {
  className?: string;
  /**
   * Classes rendered on the row's pointer-events-none ring overlay (gap
   * closure 26.2-15, UAT gap 12) instead of on the row's own `className`.
   * An outline/inset-ring drawn directly on the row loses to a pinned
   * (sticky) cell's opaque background and `z-index: 2` (`getFlexPinningStyles`
   * in `dataTableShared.tsx`) -- the pinned cell paints over it. The overlay
   * sits ABOVE every cell (`z-20`) and never intercepts pointer/drag events,
   * so a candidate-row or drag-hover ring stays visible across the FULL row
   * width, including over a pinned Actions column, while pinned-cell clicks
   * (e.g. the kebab menu) keep working unchanged.
   */
  ringClassName?: string;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onDragEnter?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
}

export interface VirtualizedTableEngineProps {
  columns: ColumnDef<any, any>[];
  data: any[];

  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (visibility: VisibilityState) => void;

  sortConfig?: SortConfig | null;
  onSortChange?: (columnId: string) => void;
  /**
   * Explicit-direction sort, used by the header column menu (the cycling
   * `onSortChange` can't express a direction). `null` clears the sort.
   */
  onSortColumn?: (columnId: string, direction: "asc" | "desc" | null) => void;
  /**
   * Hide a column from the header menu. Routed to a callback (rather than
   * TanStack's `toggleVisibility`) so the owner of visibility state — the
   * Columns control — makes the change, keeping persistence and the checkboxes
   * in sync. The menu's Hide item only renders when this is provided.
   */
  onHideColumn?: (columnId: string) => void;
  /**
   * Per-column header menu (explicit sort direction + hide column). Defaults
   * to on when `onSortColumn` or `onHideColumn` is wired — the menu can only
   * offer actions a handler will actually perform; headers keep the plain
   * label + sort-cycle button otherwise.
   */
  enableColumnMenu?: boolean;

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
  /** Row-level click, mirroring paged mode's `onTestCaseClick`. Interactive
   * cell content (checkboxes, buttons) must stop propagation to opt out.
   * Grouped lead rows never fire it. */
  onRowClick?: (id: number | string) => void;

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

  /**
   * Drag-to-reorder for non-pinned columns via a grip handle in each header.
   * Defaults to on whenever the table has a persistence key (an explicit
   * `columnSizingStorageKey`, or a real `testIdPrefix` it can fall back to);
   * the new order is remembered per user under that key, in the same
   * localStorage namespace the paged engine uses. Pass `false` to turn the
   * handles off.
   */
  enableColumnReorder?: boolean;

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
  /**
   * Per-row extension point for inert DOM props on a virtualized row's outer
   * element. Called once per VISIBLE row on every render (the visible row
   * count changes as the user scrolls), so it MUST be a pure function and
   * MUST NEVER call a React hook — hang any per-row hook off a real
   * component instead, never off this callback.
   *
   * The returned `className` is appended LAST to the row's own class list,
   * so it composes with (and can override) the engine's `highlightRowId`
   * treatment rather than replacing it.
   *
   * There is deliberately no `ref` slot: the engine's own virtualizer
   * `measureElement` ref must keep a stable identity, or TanStack Virtual
   * re-measures every row on every render. A consumer that needs the row's
   * DOM node reads `event.currentTarget` from one of the handlers below, or
   * queries `[data-row-id]`.
   */
  getRowProps?: (row: Row<any>) => VirtualizedRowExtraProps | undefined;
  testIdPrefix?: string;
  rowTestIdPrefix?: string;
}

export function VirtualizedTableEngine({
  columns,
  data,
  columnVisibility,
  onColumnVisibilityChange,
  sortConfig,
  onSortChange,
  onSortColumn,
  onHideColumn,
  enableColumnMenu: enableColumnMenuProp,
  grouping,
  onGroupingChange,
  expanded,
  onExpandedChange,
  getSubRows,
  subRowsLabel,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  onRowClick,
  flexColumnId,
  enableColumnPinning = true,
  pinFirstLast = true,
  pinnedColumnStyle,
  pinnedHeaderStyle,
  columnSizingStorageKey,
  enableColumnReorder: enableColumnReorderProp,
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
  getRowProps,
  testIdPrefix = "virtualized-table",
  rowTestIdPrefix = "virtualized-row",
}: VirtualizedTableEngineProps) {
  const t = useTranslations("common.table");
  const tActions = useTranslations("common.actions");
  const tLabels = useTranslations("common.labels");
  const tAria = useTranslations("common.aria");
  const tErrors = useTranslations("search.errors");

  const { sorting, handleSortingChange } = useSortingAdapter(
    sortConfig,
    onSortChange,
    columns
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
  // Reorder rides the same per-surface key as widths: on wherever the table
  // can remember the order, off for keyless (stateless) tables.
  const enableColumnReorder =
    enableColumnReorderProp ?? !!effectiveColumnSizingKey;
  // The header menu only appears when a handler is wired to act on it.
  const enableColumnMenu =
    enableColumnMenuProp ?? Boolean(onSortColumn || onHideColumn);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

  // Stored widths are applied AFTER mount, never from the initializer: the
  // server has no localStorage, so seeding there makes the first client render
  // disagree with the server markup — React keeps the server's default widths
  // and the table is stranded on them for the life of the page. Keyed on the
  // storage key rather than mount-once because a surface can swap keys while
  // mounted (the report renderer scopes the key per report type); with nothing
  // stored under the key the current widths stand.
  useEffect(() => {
    if (!columnSizingStorage) return;
    try {
      const raw = window.localStorage.getItem(columnSizingStorage);
      if (raw) setColumnSizing(JSON.parse(raw) as ColumnSizingState);
    } catch {
      // storage unavailable / malformed entry — keep the default widths
    }
  }, [columnSizingStorage]);

  // Column pinning: seed the left/right pin sets once (explicit `meta.isPinned`
  // first, first/last fallback otherwise), then let TanStack own the state.
  const [columnPinning, setColumnPinning] = useInitialColumnPinning({
    columns,
    grouping,
    getSubRows,
    enabled: enableColumnPinning,
    autoPinFirstLast: pinFirstLast,
  });

  // In pinning mode the body scrolls horizontally; this ref lets the header
  // viewport mirror the body's scrollLeft so the columns stay aligned.
  const headerScrollRef = useRef<HTMLDivElement>(null);

  // Prepend an expander column when rows can nest (grouping or sub-rows).
  const expanderColumn = useExpanderColumn<any>(subRowsLabel);

  const groupingActive = !!(grouping && grouping.length > 0);
  const finalColumns = useMemo(
    () =>
      groupingActive || getSubRows ? [expanderColumn, ...columns] : columns,
    [groupingActive, getSubRows, expanderColumn, columns]
  );

  // Drag-to-reorder columns, persisted per surface under the same key as
  // widths.
  const {
    columnOrder,
    setColumnOrder,
    handleColumnDragEnd,
    columnDragSensors,
  } = usePersistedColumnOrder({
    enabled: enableColumnReorder,
    storageKey: effectiveColumnSizingKey,
    finalColumns,
  });

  const table = useReactTable({
    data,
    columns: finalColumns,
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: groupingActive ? getGroupedRowModel() : undefined,
    getExpandedRowModel:
      groupingActive || getSubRows ? getExpandedRowModel() : undefined,
    getSubRows,
    enableSorting: true,
    // The CALLER owns row order (server orderBy or its own sort of `data`) —
    // sortConfig is display state. Without this, TanStack re-sorts the rows
    // client-side by each column's accessor, fighting the server: enum columns
    // sort by Postgres enum-definition order server-side but alphabetically
    // client-side, and infinite-scroll page seams get scrambled.
    manualSorting: true,
    enableColumnResizing: true,
    enableColumnPinning,
    enableRowSelection: rowSelection !== undefined,
    ...(getRowId ? { getRowId } : {}),
    columnResizeMode: "onChange",
    state: {
      columnVisibility,
      sorting,
      columnSizing,
      ...(enableColumnReorder && { columnOrder }),
      ...(enableColumnPinning && { columnPinning }),
      ...(rowSelection !== undefined && { rowSelection }),
      ...(grouping !== undefined && { grouping }),
      ...(expanded !== undefined && { expanded }),
    },
    ...(enableColumnReorder && { onColumnOrderChange: setColumnOrder }),
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

  // Start a column-resize drag. For the FLEX column, first seed its tracked
  // size from the rendered width: while it absorbs slack its on-screen width
  // exceeds `getSize()`, and TanStack measures the drag from `getSize()` — so
  // without the seed the drag would silently adjust an invisible minimum and
  // the column wouldn't appear to move. `flushSync` commits the seed before
  // the resize handler captures its start size (we're in a DOM event handler,
  // where flushSync is legal). After a resize the column keeps flexing, but
  // never below the width the user chose; double-click still resets it.
  const beginResize = useCallback(
    (header: any, e: React.MouseEvent | React.TouchEvent) => {
      const column = header.column;
      if (hasFlex && column.id === flexColumnId) {
        const cell = (e.currentTarget as HTMLElement).closest(
          '[role="columnheader"]'
        ) as HTMLElement | null;
        const rendered = cell?.getBoundingClientRect().width;
        if (rendered && Math.abs(rendered - column.getSize()) > 1) {
          flushSync(() => {
            setColumnSizing((prev) => ({
              ...prev,
              [column.id]: Math.round(rendered),
            }));
          });
        }
      }
      header.getResizeHandler()(e);
    },
    [hasFlex, flexColumnId]
  );
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

  const tableElement = (
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
            {(() => {
              const renderHeaderCell = (
                header: (typeof headers)[number],
                shell: {
                  setNodeRef?: (node: HTMLElement | null) => void;
                  dragStyle: CSSProperties;
                  grip: ReactNode;
                }
              ) => {
                const { column } = header;
                const isSortable =
                  column.columnDef.enableSorting !== false &&
                  column.id !== "expander";
                const isActiveSort = sortConfig?.column === column.id;
                const direction = isActiveSort
                  ? sortConfig?.direction
                  : undefined;
                const isFlex = hasFlex && column.id === flexColumnId;
                return (
                  <div
                    key={header.id}
                    ref={shell.setNodeRef}
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
                      ...(enableColumnPinning
                        ? getFlexPinningStyles(column)
                        : {}),
                      ...(enableColumnPinning && column.getIsPinned()
                        ? (pinnedHeaderStyle ?? pinnedColumnStyle ?? {})
                        : {}),
                      ...shell.dragStyle,
                    }}
                  >
                    {shell.grip}
                    {column.getCanGroup() && onGroupingChange ? (
                      <button
                        type="button"
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
                    {(() => {
                      const canHide =
                        Boolean(onHideColumn) &&
                        column.getCanHide() &&
                        column.id !== "expander";
                      const hasMenu =
                        enableColumnMenu && (isSortable || canHide);
                      const sortIndicator =
                        isActiveSort && direction === "asc" ? (
                          <ArrowDownAZ className="h-4 w-4" />
                        ) : isActiveSort && direction === "desc" ? (
                          <ArrowUpZA className="h-4 w-4" />
                        ) : (
                          <ArrowDownUp className="h-4 w-4 opacity-50" />
                        );
                      if (hasMenu) {
                        return (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="flex min-w-0 cursor-pointer items-center gap-1 outline-none"
                                aria-label={t("columnOptions")}
                              >
                                <TruncatedHeaderLabel>
                                  {flexRender(
                                    column.columnDef.header,
                                    header.getContext()
                                  )}
                                </TruncatedHeaderLabel>
                                {isSortable && sortIndicator}
                                <ChevronDown
                                  className="h-3 w-3 shrink-0 opacity-50"
                                  aria-hidden="true"
                                />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <ColumnMenuItems
                                columnId={column.id}
                                isSortable={isSortable}
                                canHide={canHide}
                                isActiveSort={Boolean(isActiveSort)}
                                sortDirection={direction}
                                onSortColumn={onSortColumn}
                                onHideColumn={onHideColumn}
                              />
                            </DropdownMenuContent>
                          </DropdownMenu>
                        );
                      }
                      return (
                        <>
                          <TruncatedHeaderLabel>
                            {flexRender(
                              column.columnDef.header,
                              header.getContext()
                            )}
                          </TruncatedHeaderLabel>
                          {isSortable && (
                            <button
                              type="button"
                              onClick={() => onSortChange?.(column.id)}
                              className="ms-1 shrink-0 cursor-pointer"
                              aria-label={t("sort")}
                            >
                              {sortIndicator}
                            </button>
                          )}
                        </>
                      );
                    })()}
                    {/* Drag-to-resize handle on the column's right edge. The
                      expander column opts out via enableResizing:false. The
                      flex column is resizable too — beginResize seeds its size
                      from the rendered width so the drag tracks what's on
                      screen; the chosen width becomes its minimum while it
                      keeps absorbing slack. */}
                    {column.getCanResize() && (
                      <div
                        onMouseDown={(e) => beginResize(header, e)}
                        onTouchStart={(e) => beginResize(header, e)}
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
              };

              const visibleHeaders = headers.filter((header) =>
                header.column.getIsVisible()
              );
              if (!enableColumnReorder) {
                return visibleHeaders.map((header) =>
                  renderHeaderCell(header, { dragStyle: {}, grip: null })
                );
              }
              // Pinned columns and the expander stay put; everything else can
              // be dragged.
              const reorderDisabledFor = (
                column: (typeof headers)[number]["column"]
              ) =>
                (enableColumnPinning && !!column.getIsPinned()) ||
                column.id === "expander";
              return (
                <SortableContext
                  items={visibleHeaders
                    .filter((h) => !reorderDisabledFor(h.column))
                    .map((h) => h.column.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  {visibleHeaders.map((header) => (
                    <SortableHeaderShell
                      key={header.id}
                      id={header.column.id}
                      disabled={reorderDisabledFor(header.column)}
                      reorderLabel={t("reorderColumn")}
                    >
                      {(shell) => renderHeaderCell(header, shell)}
                    </SortableHeaderShell>
                  ))}
                </SortableContext>
              );
            })()}
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
                const rowExtra = getRowProps?.(row);
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
                    onClick={
                      (onRowClick && !isGrouped && row.original?.id != null) ||
                      rowExtra?.onClick
                        ? (event) => {
                            if (
                              onRowClick &&
                              !isGrouped &&
                              row.original?.id != null
                            ) {
                              onRowClick(row.original.id);
                            }
                            rowExtra?.onClick?.(event);
                          }
                        : undefined
                    }
                    onDragEnter={rowExtra?.onDragEnter}
                    onDragOver={rowExtra?.onDragOver}
                    onDragLeave={rowExtra?.onDragLeave}
                    className={cn(
                      "absolute start-0 top-0 flex border-b",
                      onRowClick && !isGrouped && "cursor-pointer",
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
                      // Tint only -- the outline itself moved to the ring
                      // overlay below (gap closure 26.2-15) so it paints
                      // above pinned cells too.
                      isHighlighted && "bg-primary/10",
                      rowExtra?.className
                    )}
                    style={{
                      width: tableWidth,
                      minWidth: flexMinWidth,
                      transform: `translateY(${vItem.start}px)`,
                    }}
                  >
                    {row.getVisibleCells().map((cell, cellIndex) => {
                      const { column } = cell;
                      const content = resolveGroupableCellContent(
                        cell,
                        row,
                        groupingActive,
                        tActions
                      );
                      const isFlex = hasFlex && column.id === flexColumnId;
                      // Cells truncate to a single line by default so long raw
                      // text doesn't wrap and grow the row — the user widens the
                      // column to see more. A column opts out with
                      // `meta: { wrap: true }`.
                      const wrap = (
                        column.columnDef.meta as CustomColumnMeta | undefined
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
                              ? getFlexPinningStyles(column)
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
                    {/* Ring/highlight overlay -- rendered ABOVE every cell,
                        including a pinned (sticky) one, so an outline drawn
                        here can never lose to the pinned cell's own opaque
                        background + `z-index: 2` the way one painted on the
                        row's own box does (gap closure 26.2-15, UAT gap 12).
                        `pointer-events-none` so it never steals a click from
                        the pinned Actions cell's kebab menu, or a native
                        drag event from the row beneath it. Only mounted when
                        there is something to show -- `isHighlighted` (the
                        deep-link ring) or a consumer's own `ringClassName`
                        (e.g. the requirements list's drag-candidate/drag-over
                        rings) -- so a plain, unselected row costs nothing
                        extra. */}
                    {(isHighlighted || rowExtra?.ringClassName) && (
                      <div
                        aria-hidden="true"
                        data-testid={`${rowTestIdPrefix}-${row.original?.id ?? vItem.index}-ring`}
                        className={cn(
                          "pointer-events-none absolute inset-0 z-20",
                          // Offset must equal the negated outline width: the
                          // row is absolutely positioned inside a clipping
                          // scroll container, so any part of the outline
                          // that bleeds outside the overlay's own border box
                          // gets clipped. At -outline-offset-2 with a 4px
                          // outline, 2px bled past the edge -- invisible on
                          // the start/end sides (the container's clip edge)
                          // but rendered on top/bottom (which overlap
                          // neighbouring rows instead), producing a ring
                          // that looked half-thickness on one side and fully
                          // clipped on the other. -outline-offset-4 draws
                          // the whole ring inside the box, so there's
                          // nothing left for the container to clip.
                          isHighlighted &&
                            "outline outline-4 -outline-offset-4 outline-primary",
                          rowExtra?.ringClassName
                        )}
                      />
                    )}
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

  if (!enableColumnReorder) return tableElement;

  // The DndContext wraps the whole table (not just the header row) because it
  // renders a hidden accessibility <div> that must not join the header's flex
  // layout.
  return (
    <DndContext
      sensors={columnDragSensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      onDragEnd={handleColumnDragEnd}
    >
      {tableElement}
    </DndContext>
  );
}
