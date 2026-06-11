"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes TanStack Table / TanStack Virtual APIs that return unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it (same as components/matrix/MatrixGrid.tsx and hooks/useVirtualizedInfiniteList.ts). */

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ColumnDef,
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
import { type ReactNode, useCallback, useMemo } from "react";
import { useVirtualizedInfiniteList } from "~/hooks/useVirtualizedInfiniteList";
import { cn } from "~/utils";

/**
 * Virtualized, infinite-scrolling table for the reports results panel.
 *
 * A reports-specific alternative to the shared `DataTable` — it deliberately
 * does NOT replicate that component's look or its column resize/pinning (no
 * report column opts into either). It keeps the table features reports rely on
 * (sorting, grouping, expansion, sub-rows, column visibility) by driving a
 * TanStack `useReactTable` instance and rendering its flattened row model
 * (`getRowModel().rows`) through `useVirtualizedInfiniteList`, so an arbitrarily
 * large result set scrolls as one continuous list with no page seam.
 *
 * Layout: an outer horizontal-scroll container holds a flex column whose width
 * is the summed column width; a non-scrolling header row sits on top and a
 * vertical-scroll body (the virtualizer's scroll element) holds the rows. Both
 * header and body size every cell from `column.getSize()`, so they stay aligned
 * while the whole table scrolls horizontally as a unit.
 *
 * Pagination modes:
 *   - Full-set (most reports): caller passes the entire array with
 *     `hasMore=false`; the list virtualizes it.
 *   - Fetch-on-scroll (execution-log): caller supplies `hasMore`/`isLoading`/
 *     `onLoadMore`; the sentinel pulls and the caller appends.
 */

const EXPANDER_WIDTH = 24;
const ESTIMATED_ROW_HEIGHT = 44;

interface VirtualizedReportTableProps {
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

  // Infinite scroll (defaults keep the table in full-set / client mode).
  hasMore?: boolean;
  isLoading?: boolean;
  onLoadMore?: () => void;
  loadMoreError?: boolean;
  onRetryLoadMore?: () => void;

  rowTestIdPrefix?: string;
}

export function VirtualizedReportTable({
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
  hasMore = false,
  isLoading = false,
  onLoadMore,
  loadMoreError = false,
  onRetryLoadMore,
  rowTestIdPrefix = "report-row",
}: VirtualizedReportTableProps) {
  const t = useTranslations("common.table");
  const tActions = useTranslations("common.actions");
  const tLabels = useTranslations("common.labels");
  const tAria = useTranslations("common.aria");
  const tErrors = useTranslations("search.errors");

  // Convert the report's sortConfig into TanStack's controlled sorting state,
  // ignoring a stale sort that points at a column the current report lacks
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
    state: {
      columnVisibility,
      sorting,
      ...(grouping !== undefined && { grouping }),
      ...(expanded !== undefined && { expanded }),
    },
    ...(onGroupingChange !== undefined && { onGroupingChange }),
    ...(onExpandedChange !== undefined && { onExpandedChange }),
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: handleVisibilityChange,
    defaultColumn: { minSize: 50, maxSize: 1500, size: 150 },
  });

  const rows = table.getRowModel().rows;
  const leafColumns = table.getVisibleLeafColumns();
  const totalWidth = leafColumns.reduce((sum, c) => sum + c.getSize(), 0);

  // Reset scroll + measurements when the *result set identity* changes (sort,
  // grouping, or report type via the column set) — but NOT when a page is
  // appended (that would defeat infinite scroll).
  const resetKey = useMemo(
    () =>
      JSON.stringify({
        sort: sortConfig ?? null,
        grouping: grouping ?? null,
        cols: columns.map((c) => c.id),
      }),
    [sortConfig, grouping, columns]
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
      data-testid="report-table"
    >
      <div
        className="flex h-full min-h-0 flex-col"
        style={{ width: totalWidth, minWidth: "100%" }}
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
              return (
                <div
                  key={header.id}
                  role="columnheader"
                  className="flex shrink-0 select-none items-center gap-1 border-r px-3 py-2 text-xs font-medium last:border-r-0"
                  style={{ width: column.getSize() }}
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
                </div>
              );
            })}
        </div>

        {/* Body — the virtualizer's scroll element. CSS-bounded height
            (flex-1) so it works inside the resizable report panel. */}
        <div
          ref={scrollRef}
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          data-testid="report-table-scroll"
        >
          {rows.length === 0 && !isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {tLabels("noResults")}
            </div>
          ) : (
            <div
              className="relative"
              style={{ height: totalSize, width: totalWidth }}
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
                          ? "bg-muted/5 hover:bg-muted/20"
                          : "hover:bg-muted/50"
                    )}
                    style={{
                      width: totalWidth,
                      transform: `translateY(${vItem.start}px)`,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
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
                      return (
                        <div
                          key={column.id}
                          role="cell"
                          className="flex min-w-0 shrink-0 items-center overflow-hidden border-r px-3 py-2 text-sm last:border-r-0"
                          style={{ width: column.getSize() }}
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
              fetches the next page (execution-log only). */}
          <div
            ref={sentinelRef}
            aria-hidden
            className="h-px w-full"
            data-testid="report-table-sentinel"
          />

          {isLoading && data.length > 0 && (
            <div
              className="space-y-2 px-3 py-3"
              data-testid="report-table-loading-more"
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
                data-testid="report-table-load-more-retry"
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
