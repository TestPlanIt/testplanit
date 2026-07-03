"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes TanStack Table / TanStack Virtual APIs that return unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it (same as components/matrix/MatrixGrid.tsx and hooks/useVirtualizedInfiniteList.ts). */

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ColumnDef,
  ColumnSizingState,
  ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  OnChangeFn,
  Row,
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
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizedInfiniteList } from "~/hooks/useVirtualizedInfiniteList";
import { cn } from "~/utils";

/**
 * Virtualized, infinite-scrolling table.
 *
 * A lighter-weight alternative to the shared `DataTable` for surfaces that need
 * to render an arbitrarily large result set as one continuous, page-seam-free
 * list. It supports draggable column resizing (live, and optionally persisted
 * per user via `columnSizingStorageKey`) but deliberately does NOT replicate
 * `DataTable`'s column pinning / drag-reorder; it keeps the table features that
 * scroll well (sorting, grouping, expansion, sub-rows, column visibility) by
 * driving a TanStack `useReactTable` instance and rendering its flattened row
 * model (`getRowModel().rows`) through `useVirtualizedInfiniteList`.
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
   * Id of a column that should flex to absorb any horizontal space left over
   * once the other (fixed-width) columns are laid out — so a table wider than
   * its content doesn't leave a gap after the last column. The column never
   * shrinks below its declared `size`; when the content is wider than the
   * viewport the table falls back to horizontal scroll.
   */
  flexColumnId?: string;

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
  flexColumnId,
  columnSizingStorageKey,
  hasMore = false,
  isLoading = false,
  onLoadMore,
  loadMoreError = false,
  onRetryLoadMore,
  emptyMessage,
  resetKey: externalResetKey,
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
  const columnSizingStorage = columnSizingStorageKey
    ? `vdt:colsize:${columnSizingStorageKey}`
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
    columnResizeMode: "onChange",
    state: {
      columnVisibility,
      sorting,
      columnSizing,
      ...(grouping !== undefined && { grouping }),
      ...(expanded !== undefined && { expanded }),
    },
    ...(onGroupingChange !== undefined && { onGroupingChange }),
    ...(onExpandedChange !== undefined && { onExpandedChange }),
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
  const leafColumns = table.getVisibleLeafColumns();
  const totalWidth = leafColumns.reduce((sum, c) => sum + c.getSize(), 0);

  // When a flex column is configured, the table stretches to fill its container
  // (and the flex column soaks up the slack) instead of sitting at its natural
  // content width with empty space trailing the last column.
  const hasFlex =
    !!flexColumnId && leafColumns.some((c) => c.id === flexColumnId);
  const tableWidth = hasFlex ? "100%" : totalWidth;

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

  const { scrollRef, sentinelRef, virtualItems, totalSize, measureElement } =
    useVirtualizedInfiniteList({
      count: rows.length,
      estimateSize: ESTIMATED_ROW_HEIGHT,
      overscan: 8,
      hasMore,
      isLoading,
      onLoadMore: onLoadMore ?? (() => {}),
      boundToViewport: false,
      resetKey,
    });

  const headers = table.getHeaderGroups().at(-1)?.headers ?? [];

  return (
    <div
      className="h-full overflow-x-auto rounded-lg border-2 border-primary/10"
      role="table"
      data-testid={testIdPrefix}
    >
      <div
        className="flex h-full min-h-0 flex-col"
        style={{ width: tableWidth, minWidth: hasFlex ? totalWidth : "100%" }}
      >
        {/* Header — stays put vertically (lives above the scroll body) and
            scrolls horizontally with the body via the outer container. */}
        <div
          className="flex shrink-0 border-b bg-muted text-foreground"
          role="row"
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
                    "relative flex select-none items-center gap-1 border-r px-3 py-2 text-xs font-medium last:border-r-0",
                    isFlex ? "min-w-0" : "shrink-0"
                  )}
                  style={
                    isFlex
                      ? { flex: "1 1 0%", minWidth: column.getSize() }
                      : { width: column.getSize() }
                  }
                >
                  {column.getCanGroup() && onGroupingChange ? (
                    <button
                      onClick={column.getToggleGroupingHandler()}
                      className="mr-1"
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
                  <span className="min-w-0 truncate">
                    {flexRender(column.columnDef.header, header.getContext())}
                  </span>
                  {isSortable && column.id !== "expander" && (
                    <button
                      onClick={() => onSortChange?.(column.id)}
                      className="ml-1 shrink-0"
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
                        "absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none transition-colors hover:bg-primary/40",
                        column.getIsResizing() ? "bg-primary" : "bg-transparent"
                      )}
                      data-testid={`${testIdPrefix}-resize-${column.id}`}
                    />
                  )}
                </div>
              );
            })}
        </div>

        {/* Body — the virtualizer's scroll element. CSS-bounded height
            (flex-1) so it works inside a bounded panel or card. */}
        <div
          ref={scrollRef}
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          data-testid={`${testIdPrefix}-scroll`}
        >
          {rows.length === 0 && !isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {emptyMessage ?? tLabels("noResults")}
            </div>
          ) : (
            <div
              className="relative"
              style={{ height: totalSize, width: tableWidth }}
            >
              {virtualItems.map((vItem) => {
                const row = rows[vItem.index];
                if (!row) return null;
                const isGrouped = row.getIsGrouped();
                const isSubRow = row.depth > 0;
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
                      "absolute left-0 top-0 flex border-b",
                      isGrouped
                        ? "bg-muted font-semibold text-foreground"
                        : isSubRow
                          ? // Nested detail rows: a shaded block (the colored nesting
                            // bar is drawn on the right edge of the first/indent cell
                            // below) so the run of sub-rows reads as one group and the
                            // next (unshaded) parent row is clearly the boundary.
                            "bg-muted/40 hover:bg-muted/60"
                          : "hover:bg-muted/50"
                    )}
                    style={{
                      width: tableWidth,
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
                              className="mr-1 p-1"
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
                      return (
                        <div
                          key={column.id}
                          role="cell"
                          className={cn(
                            "flex min-w-0 items-center overflow-hidden border-r px-3 py-2 text-sm last:border-r-0",
                            !isFlex && "shrink-0",
                            // Nesting guide: a wide colored bar on the RIGHT edge of
                            // the first (indent) cell of a sub-row, marking where the
                            // nested content begins.
                            isSubRow &&
                              cellIndex === 0 &&
                              "border-r-4 border-r-primary"
                          )}
                          style={
                            isFlex
                              ? { flex: "1 1 0%", minWidth: column.getSize() }
                              : { width: column.getSize() }
                          }
                        >
                          {content}
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
