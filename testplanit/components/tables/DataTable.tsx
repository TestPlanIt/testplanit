"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ColumnDef,
  ColumnOrderState,
  ColumnSizingState,
  ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  OnChangeFn,
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
  Group,
  GripVertical,
  UnfoldVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import React, {
  CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "~/lib/navigation";
import SortableItem from "./SortableItem";
import { tableStyles } from "./tableStyles";
import {
  readStoredColumnOrder,
  readStoredColumnWidths,
  writeStoredColumnOrder,
  writeStoredColumnWidths,
} from "./ColumnSelection";
import {
  ColumnMenuItems,
  type CustomColumnMeta,
  type DataRow,
  type SortConfig,
  getCommonPinningStyles,
  reconcileColumnOrder,
  resolveGroupableCellContent,
  shallowEqualRecord,
  useExpanderColumn,
  useInitialColumnPinning,
  useSortingAdapter,
} from "./dataTableShared";
import {
  VirtualizedTableEngine,
  type VirtualizedTableEngineProps,
} from "./VirtualizedTableEngine";

export { reconcileColumnOrder } from "./dataTableShared";
export type { CustomColumnMeta, DataRow } from "./dataTableShared";

// Structure for items passed to SortableItem for drag preview
interface DraggedCaseInfoForSortableItem {
  id: number | string;
  name: string;
}

/**
 * Props shared by both render modes of `DataTable`.
 */
export interface DataTableBaseProps<TData extends DataRow, TValue = any> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  columnVisibility: Record<string, boolean>;
  onColumnVisibilityChange: (visibility: Record<string, boolean>) => void;
  sortConfig?: SortConfig | null;
  onSortChange?: (columnId: string) => void;
  grouping?: string[];
  onGroupingChange?: OnChangeFn<string[]>;
  expanded?: ExpandedState;
  onExpandedChange?: OnChangeFn<ExpandedState>;
  getSubRows?: (originalRow: TData, index: number) => TData[] | undefined;
  subRowsLabel?: string;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Stable row identity for selection state — without it TanStack keys
   * selection by row INDEX, which silently re-targets selections when the
   * data is filtered or re-sorted. */
  getRowId?: (originalRow: TData, index: number) => string;
  /** Whether a fetch is in flight. Paged mode swaps the body for skeleton rows
   * (`pageSize` of them, after a 300ms delay) and suppresses the empty state;
   * virtualized mode keeps the loaded rows, shows a bottom skeleton while a
   * page appends, and gates the load-more trigger. */
  isLoading?: boolean;
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
  /** Shown when the result set is empty and not loading. Defaults to the
   * generic "no results" label so consumers only override for surface copy. */
  emptyMessage?: ReactNode;
  /** Prefix for each row's data-testid. Defaults to "case-row" in paged mode
   * and "virtualized-row" in virtualized mode (both pre-merge defaults, which
   * E2E suites rely on). Rows rendered through the paged drag-reorder path
   * (`enableReorder`) always carry the fixed `case-row-` prefix. */
  rowTestIdPrefix?: string;
}

/**
 * Paged mode (the default): renders a real `<table>` with the full (already
 * paged) row set. Supports drag-to-reorder rows, column drag-reorder + header
 * menu, and remembered column order/widths via `storageKey`.
 */
export interface PagedDataTableProps<
  TData extends DataRow,
  TValue = any,
> extends DataTableBaseProps<TData, TValue> {
  virtualized?: false;
  enableReorder?: boolean;
  onReorder?: (dragIndex: number, hoverIndex: number) => void;
  selectedItemsForDrag?: DraggedCaseInfoForSortableItem[];
  itemType?: string;
  /** Number of skeleton rows rendered while loading. */
  pageSize?: number;
  onTestCaseClick?: (id: number | string) => void;
  /** Explicit id of the row to highlight and scroll to. Falls back to the
   * `selectedCase` search param when not provided (e.g. the run page), so the
   * repository details panel can drive it from its own `case` param. String
   * ids are accepted for tables keyed by a cuid (e.g. the reviews inbox). */
  selectedRowId?: number | string | null;
  /** Whether to scroll the selected row into view. Defaults to true (the run
   * page); the repository details panel disables it so opening/stepping through
   * a case highlights the row without jumping the list. */
  scrollToSelectedRow?: boolean;
  /** When set, column order and widths are remembered in localStorage under
   * this key (the same namespace `ColumnSelection` uses for visibility), and
   * column reordering is enabled by default. Omit to keep the table stateless
   * (the default for most callers). */
  storageKey?: string;
  /** Enable drag-to-reorder columns. Defaults to `!!storageKey` — reordering is
   * only useful when the order is remembered. */
  enableColumnReorder?: boolean;
  /** Enable the per-column header menu (sort + hide column). Defaults to
   * `!!storageKey`; requires `onSortColumn`/`onColumnVisibilityChange` to act. */
  enableColumnMenu?: boolean;
}

/**
 * Virtualized mode: renders an arbitrarily large result set as one continuous,
 * page-seam-free list (windowed rows + optional fetch-on-scroll). See
 * `VirtualizedTableEngine` for the full per-prop documentation.
 */
export interface VirtualizedDataTableProps<TData extends DataRow, TValue = any>
  extends
    DataTableBaseProps<TData, TValue>,
    Pick<
      VirtualizedTableEngineProps,
      | "flexColumnId"
      | "enableColumnPinning"
      | "pinFirstLast"
      | "pinnedColumnStyle"
      | "pinnedHeaderStyle"
      | "columnSizingStorageKey"
      | "enableColumnReorder"
      | "enableColumnMenu"
      | "hasMore"
      | "onLoadMore"
      | "loadMoreError"
      | "onRetryLoadMore"
      | "loadedCount"
      | "resetKey"
      | "estimateSize"
      | "fillViewport"
      | "scrollToRowId"
      | "highlightRowId"
      | "testIdPrefix"
    > {
  virtualized: true;
}

export type DataTableProps<TData extends DataRow, TValue = any> =
  PagedDataTableProps<TData, TValue> | VirtualizedDataTableProps<TData, TValue>;

/**
 * The shared data table. One component, two render modes selected by the
 * `virtualized` parameter:
 *
 *   - Paged (default): a real `<table>` rendering the full row set the caller
 *     already paged (via `Pagination`), with row drag-reorder, column
 *     drag-reorder, the header column menu, and remembered column prefs.
 *   - `virtualized`: windowed rows through `useVirtualizedInfiniteList` for
 *     arbitrarily large result sets, with optional fetch-on-scroll
 *     (`hasMore`/`onLoadMore`), viewport filling, and deep-link scroll.
 *
 * Both modes share sorting, grouping, expansion, sub-rows, selection, column
 * visibility/resizing/pinning semantics and the same visual language
 * (`tableStyles`).
 */
export function DataTable<TData extends DataRow, TValue = any>(
  props: DataTableProps<TData, TValue>
) {
  if (props.virtualized) {
    const { virtualized: _virtualized, ...engineProps } = props;
    return <VirtualizedTableEngine {...engineProps} />;
  }
  const { virtualized: _virtualized, ...pagedProps } = props;
  return <PagedTable {...pagedProps} />;
}

type HeadCellContentProps = {
  header: any;
  sortConfig?: SortConfig;
  onSortIconClick: (header: any) => void;
  onResizeMouseDown: (header: any, e: React.MouseEvent) => void;
  onGroupingChange?: OnChangeFn<string[]>;
  onSortColumn?: (columnId: string, direction: "asc" | "desc" | null) => void;
  onHideColumn?: (columnId: string) => void;
  enableColumnMenu?: boolean;
};

/**
 * The inner content of a header cell — grouping toggle, header label, sort icon,
 * and resize separator — plus an optional leading drag handle. Renders
 * identically in the plain and the reorderable header-cell variants.
 */
function HeadCellContent({
  header,
  sortConfig,
  onSortIconClick,
  onResizeMouseDown,
  onGroupingChange,
  onSortColumn,
  onHideColumn,
  enableColumnMenu,
  dragHandle,
}: HeadCellContentProps & { dragHandle?: React.ReactNode }) {
  const t = useTranslations("common.table");
  const tCommon = useTranslations("common");
  const isSortable = header.column.columnDef.enableSorting;
  const isActiveSort = sortConfig?.column === header.column.id;
  const sortDirection = isActiveSort ? sortConfig?.direction : undefined;
  // Hide is only offered when the column can be hidden AND an owner is wired to
  // apply it (so persistence + the Columns control stay in sync).
  const canHide = header.column.getCanHide() && Boolean(onHideColumn);
  const hasMenu = Boolean(enableColumnMenu) && (isSortable || canHide);
  const sortIndicator =
    isActiveSort && sortDirection === "asc" ? (
      <ArrowDownAZ className="h-4 w-4" aria-label={t("sortAscending")} />
    ) : isActiveSort && sortDirection === "desc" ? (
      <ArrowUpZA className="h-4 w-4" aria-label={t("sortDescending")} />
    ) : (
      <ArrowDownUp className="h-4 w-4" aria-label={t("sortNone")} />
    );
  return (
    <div className="flex gap-2 items-center justify-between relative h-full">
      <div className="flex items-center gap-1 whitespace-nowrap">
        {dragHandle}
        {header.column.getCanGroup() && onGroupingChange ? (
          <button
            type="button"
            onClick={header.column.getToggleGroupingHandler()}
            style={{ cursor: "pointer" }}
            className="me-1"
            title={
              header.column.getIsGrouped() ? "Ungroup" : "Group by this column"
            }
          >
            {header.column.getIsGrouped() ? (
              <UnfoldVertical
                className="inline h-4 w-4"
                aria-label={tCommon("aria.grouped")}
              />
            ) : (
              <Group
                className="inline h-4 w-4"
                aria-label={tCommon("aria.group")}
              />
            )}
          </button>
        ) : null}
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 whitespace-nowrap cursor-pointer outline-none"
                aria-label={t("columnOptions")}
              >
                {flexRender(
                  header.column.columnDef.header,
                  header.getContext()
                )}
                {isSortable && sortIndicator}
                <ChevronDown
                  className="h-3 w-3 opacity-50"
                  aria-hidden="true"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <ColumnMenuItems
                columnId={header.column.id}
                isSortable={Boolean(isSortable)}
                canHide={canHide}
                isActiveSort={isActiveSort}
                sortDirection={sortDirection}
                onSortColumn={onSortColumn}
                onHideColumn={onHideColumn}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <>
            {flexRender(header.column.columnDef.header, header.getContext())}
            {isSortable && (
              <div
                onClick={() => onSortIconClick(header)}
                className="ms-1 cursor-pointer"
                aria-label={t("sort")}
                role="button"
              >
                {sortIndicator}
              </div>
            )}
          </>
        )}
      </div>
      {header.column.getCanResize() && (
        <div
          role="separator"
          aria-orientation="vertical"
          onDoubleClick={() => header.column.resetSize()}
          onMouseDown={(e) => onResizeMouseDown(header, e)}
          onTouchStart={header.getResizeHandler()}
          // A wide, transparent hit area centred on the column boundary so the
          // handle is easy to grab on every column — not just a pinned one,
          // whose own stacking context used to be the only place the thin handle
          // sat above its neighbours. `-top-2 / h+1rem` grows past the header's
          // vertical padding so it spans the full row height; `z-20` lifts it
          // above adjacent (including pinned) cells; the visible 1px line stays
          // centred on the boundary and highlights on hover.
          className="group/resize absolute end-[-15px] -top-2 z-20 flex h-[calc(100%+1rem)] w-3.5 cursor-col-resize touch-none select-none justify-center"
          aria-label={t("resize")}
        >
          <div
            className={`h-full w-px ${
              header.column.getIsResizing()
                ? "bg-primary/60"
                : "bg-primary/30 group-hover/resize:bg-primary/60"
            }`}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Class names for a header cell, including the sorted-column indicator: a solid
 * primary accent bar whose edge encodes the direction — top edge when sorted
 * ascending, bottom edge when descending. Every header cell reserves transparent
 * top/bottom borders so colouring one edge doesn't shift the row. The cell keeps
 * its own background; the sort is signalled by the accent bar alone.
 */
function getHeadCellClassName(header: any, sortConfig?: SortConfig): string {
  const base = `select-none ${tableStyles.headerCell} px-2 border-y-2 border-transparent ${
    header.column.getIsPinned()
      ? "bg-primary-foreground"
      : "bg-primary-foreground/80"
  }`;
  if (!sortConfig || sortConfig.column !== header.column.id) return base;
  const bar =
    sortConfig.direction === "asc" ? "border-t-primary" : "border-b-primary";
  return `${base} ${bar}`;
}

/**
 * A reorderable (dnd-kit) header cell. The whole cell is the sortable node (so
 * it slides during a drag), but only the grip carries the drag listeners — sort
 * clicks and the resize handle keep working, and the 5px pointer-activation
 * constraint means a click never starts a drag. Used only for non-pinned
 * columns when reordering is enabled.
 */
function SortableHeadCell({ header, ...contentProps }: HeadCellContentProps) {
  const t = useTranslations("common.table");
  const { column } = header;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });
  const style: CSSProperties = {
    ...getCommonPinningStyles(column),
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
      aria-label={t("reorderColumn")}
      className="me-1 shrink-0 cursor-grab touch-none text-muted-foreground/50 hover:text-foreground active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <TableHead
      ref={setNodeRef}
      style={style}
      className={getHeadCellClassName(header, contentProps.sortConfig)}
    >
      <HeadCellContent header={header} dragHandle={grip} {...contentProps} />
    </TableHead>
  );
}

/**
 * The paged render engine behind `DataTable` (the default mode). Renders a real
 * `<table>` with the full row set the caller already paged.
 */
function PagedTable<TData extends DataRow, TValue>({
  columns,
  data,
  onSortChange,
  onSortColumn,
  onHideColumn,
  sortConfig: sortConfigProp,
  enableReorder,
  onReorder,
  columnVisibility,
  onColumnVisibilityChange,
  isLoading = false,
  pageSize = 10,
  onTestCaseClick,
  rowSelection: externalRowSelection,
  onRowSelectionChange: externalOnRowSelectionChange,
  selectedItemsForDrag,
  grouping,
  onGroupingChange,
  expanded,
  onExpandedChange,
  itemType,
  getSubRows,
  getRowId,
  subRowsLabel,
  emptyMessage,
  rowTestIdPrefix = "case-row",
  selectedRowId,
  scrollToSelectedRow = true,
  storageKey,
  enableColumnReorder = !!storageKey,
  enableColumnMenu = !!storageKey,
}: Omit<PagedDataTableProps<TData, TValue>, "virtualized">) {
  const tLabels = useTranslations("common.labels");
  const tActions = useTranslations("common.actions");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const sortConfig = sortConfigProp ?? undefined;
  const selectedCaseId =
    selectedRowId ??
    (searchParams.get("selectedCase")
      ? parseInt(searchParams.get("selectedCase")!)
      : null);

  const [showSkeleton, setShowSkeleton] = useState(false);
  const [hasScrolledToSelected, setHasScrolledToSelected] = useState(false);

  const getInitialVisibility = useCallback(() => {
    const initialVisibility: Record<string, boolean> = {};
    const columnVisibilityQuery = searchParams.get("columns");

    columns.forEach((column) => {
      // Always show columns that cannot be hidden
      if (column.enableHiding === false) {
        initialVisibility[column.id as string] = true;
      } else {
        // For other columns, use the existing logic
        if (
          column.id === columns[0].id ||
          column.id === columns[columns.length - 1].id
        ) {
          initialVisibility[column.id as string] = true;
        } else {
          initialVisibility[column.id as string] =
            (column.meta as CustomColumnMeta)?.isVisible ?? true;
        }
      }
    });

    if (columnVisibilityQuery) {
      const visibleColumns = columnVisibilityQuery.split(",");
      columns.forEach((column) => {
        // Skip columns that cannot be hidden
        if (column.enableHiding === false) {
          return;
        }
        // Skip first and last columns
        if (
          column.id !== columns[0].id &&
          column.id !== columns[columns.length - 1].id
        ) {
          initialVisibility[column.id as string] = visibleColumns.includes(
            column.id as string
          );
        }
      });
    }

    return initialVisibility;
  }, [columns, searchParams]);

  const [effectiveColumnVisibility, setEffectiveColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (isLoading) {
      timeoutId = setTimeout(() => {
        setShowSkeleton(true);
      }, 300); // 300ms delay before showing skeleton
    } else {
      setShowSkeleton(false);
    }
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isLoading]);

  useEffect(() => {
    if (Object.keys(columnVisibility).length > 0) {
      // Merge column visibility with defaults for any new columns not in the state
      // This ensures new columns (e.g., custom fields from different test cases)
      // get proper visibility based on their meta.isVisible property
      const mergedVisibility: Record<string, boolean> = { ...columnVisibility };
      columns.forEach((column) => {
        const columnId = column.id as string;
        if (mergedVisibility[columnId] === undefined) {
          // Column not in visibility state - set based on meta.isVisible or default to hidden
          const metaVisible = (column.meta as CustomColumnMeta)?.isVisible;
          mergedVisibility[columnId] = metaVisible ?? false;
        }
      });
      setEffectiveColumnVisibility((prev) =>
        shallowEqualRecord(prev, mergedVisibility) ? prev : mergedVisibility
      );
    } else {
      // Only use getInitialVisibility as fallback when columnVisibility is empty.
      // Bail out when the recomputed map is content-equal: this effect's deps
      // include `getInitialVisibility`, whose identity follows `searchParams`,
      // so setting a fresh-but-equal object here would re-render and refire the
      // effect forever whenever that identity churns.
      setEffectiveColumnVisibility((prev) => {
        const next = getInitialVisibility();
        return shallowEqualRecord(prev, next) ? prev : next;
      });
    }
  }, [columnVisibility, getInitialVisibility, columns]);

  const visibleColumns = useMemo(() => {
    // If we have effectiveColumnVisibility set, use it but still respect enableHiding: false
    if (Object.keys(effectiveColumnVisibility).length > 0) {
      return columns.filter((column) => {
        // Always show columns that cannot be hidden
        if (column.enableHiding === false) {
          return true;
        }
        return effectiveColumnVisibility[column.id as string] === true;
      });
    }

    // If columnVisibility from parent is empty, we're still initializing
    // Use column meta as default visibility
    if (Object.keys(columnVisibility).length === 0) {
      return columns.filter((column) => {
        // Always show columns that cannot be hidden
        if (column.enableHiding === false) {
          return true;
        }
        // Always show first and last columns
        if (
          column.id === columns[0]?.id ||
          column.id === columns[columns.length - 1]?.id
        ) {
          return true;
        }
        // Check meta visibility - if explicitly set to false, hide the column
        const metaVisible = (column.meta as CustomColumnMeta)?.isVisible;
        if (metaVisible === false) {
          return false;
        }
        // Default to showing columns that don't have isVisible set
        return true;
      });
    }

    // This shouldn't happen, but fallback to showing all columns
    return columns;
  }, [columns, effectiveColumnVisibility, columnVisibility]);

  const [localData, setLocalData] = useState<TData[]>(() => data || []);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  // Column order/width remembered in localStorage (opt-in via storageKey): init
  // empty and hydrate in an effect so the server render (no localStorage) and
  // the first client render match. `finalColumnsRef` gives the width-persist
  // handler the current column set without re-creating the callback.
  const didHydrateColumnPrefs = useRef(false);
  const finalColumnsRef = useRef<ColumnDef<TData, any>[]>([]);
  const [internalRowSelection, setInternalRowSelection] =
    useState<RowSelectionState>({});
  const rowSelection = externalRowSelection ?? internalRowSelection;
  const onRowSelectionChange =
    externalOnRowSelectionChange ?? setInternalRowSelection;

  const { sorting, handleSortingChange } = useSortingAdapter(
    sortConfig,
    onSortChange,
    columns
  );

  const [isResizing, setIsResizing] = useState(false);
  const clickTimeoutRef = useRef<number | null>(null);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLocalData(data || []);
  }, [data]);

  // Initialize column pinning from column meta; the auto-added expander column
  // (present when grouping or sub-rows are on) is pinned so the toggle leads
  // the row at the far left rather than floating between the last left-pinned
  // column and the first center column.
  const [columnPinning, setColumnPinning] = useInitialColumnPinning({
    columns,
    grouping,
    getSubRows,
    alwaysPinExpander: true,
  });

  // Adapter function to handle react-table's updater function format
  const handleVisibilityChange = (updaterOrValue: Updater<VisibilityState>) => {
    const newValue =
      typeof updaterOrValue === "function"
        ? updaterOrValue(effectiveColumnVisibility) // Pass current prop value if it's a function
        : updaterOrValue;
    onColumnVisibilityChange(newValue); // Call the prop with the resolved state
  };

  // Debounced column sizing handler to prevent maximum update depth errors
  const handleColumnSizingChange = useCallback(
    (updaterOrValue: Updater<ColumnSizingState>) => {
      // Clear any existing timeout
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }

      // Set a new timeout for the state update
      resizeTimeoutRef.current = setTimeout(() => {
        const newValue =
          typeof updaterOrValue === "function"
            ? updaterOrValue(columnSizing)
            : updaterOrValue;
        setColumnSizing(newValue);
        // Persist widths (opt-in). Pass the current column ids so a reset
        // (a width dropped from `newValue`) clears the stored value instead of
        // being re-loaded, while widths for other templates sharing the key are
        // preserved. Only user resizes flow through here — hydration sets
        // `columnSizing` directly — so this never fires on initial load.
        if (storageKey) {
          writeStoredColumnWidths(
            storageKey,
            newValue,
            finalColumnsRef.current.map((c) => c.id as string)
          );
        }
      }, 1); // 1ms debounce
    },
    [columnSizing, storageKey]
  );

  // dnd-kit sensors for column-header reordering. The 5px activation distance
  // keeps a click (sort) or a resize-handle drag from starting a column drag.
  const columnDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const handleColumnDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setColumnOrder((prev) => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(over.id as string);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const next = arrayMove(prev, oldIndex, newIndex);
        if (storageKey) writeStoredColumnOrder(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  // Add expander column if grouping or sub-rows are set
  const expanderColumn = useExpanderColumn<TData>(subRowsLabel);
  const finalColumns = useMemo(() => {
    if ((grouping && grouping.length > 0) || getSubRows) {
      return [expanderColumn, ...columns];
    }
    return columns;
  }, [columns, grouping, expanderColumn, getSubRows]);

  // Keep the current column set available to the width-persist handler without
  // rebuilding the callback each render.
  useEffect(() => {
    finalColumnsRef.current = finalColumns;
  }, [finalColumns]);

  // Hydrate order/width from localStorage on mount, then re-reconcile the order
  // whenever the column set changes (e.g. switching templates adds/removes
  // custom fields) so the user's arrangement of still-present columns is kept.
  // Skipped entirely for callers that neither reorder nor persist, leaving the
  // table in its default (natural-order) behaviour.
  useEffect(() => {
    if (!enableColumnReorder && !storageKey) return;
    const natural = finalColumns.map((c) => c.id as string);
    if (!didHydrateColumnPrefs.current) {
      didHydrateColumnPrefs.current = true;
      setColumnOrder(
        reconcileColumnOrder(natural, readStoredColumnOrder(storageKey))
      );
      const storedWidths = readStoredColumnWidths(storageKey);
      if (storedWidths) setColumnSizing(storedWidths);
      return;
    }
    setColumnOrder((prev) =>
      reconcileColumnOrder(natural, prev.length > 0 ? prev : null)
    );
  }, [finalColumns, storageKey, enableColumnReorder]);

  const table = useReactTable({
    data: localData,
    columns: finalColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel:
      grouping && grouping.length > 0 ? getGroupedRowModel() : undefined,
    getExpandedRowModel:
      (grouping && grouping.length > 0) || getSubRows
        ? getExpandedRowModel()
        : undefined,
    getSubRows: getSubRows,
    ...(getRowId ? { getRowId } : {}),
    enableColumnPinning: true,
    enableColumnResizing: true,
    enableRowSelection: true,
    enableSorting: true,
    state: {
      columnPinning,
      columnSizing,
      columnOrder,
      columnVisibility: effectiveColumnVisibility,
      rowSelection,
      sorting,
      ...(grouping !== undefined && { grouping: grouping }),
      ...(expanded !== undefined && { expanded: expanded }),
    },
    ...(onGroupingChange !== undefined && { onGroupingChange }),
    ...(onExpandedChange !== undefined && { onExpandedChange }),
    onSortingChange: handleSortingChange,
    onRowSelectionChange: onRowSelectionChange,
    onColumnSizingChange: handleColumnSizingChange,
    onColumnOrderChange: setColumnOrder,
    onColumnPinningChange: setColumnPinning,
    onColumnVisibilityChange: handleVisibilityChange,
    defaultColumn: {
      minSize: 50, // Min column width
      maxSize: 1500, // Max column width (matches the virtualized engine)
      size: 150, // Default column width
      enableResizing: true, // Explicitly enable resizing by default
    },
    columnResizeMode: "onChange",
    debugTable: false,
  });

  // Use prop if provided, otherwise fall back to internal logic
  const selectedItemsForDragFinal: DraggedCaseInfoForSortableItem[] =
    selectedItemsForDrag !== undefined
      ? selectedItemsForDrag
      : table.getSelectedRowModel().flatRows.map((row) => ({
          id: row.original.id,
          name: row.original.name ?? "",
        }));

  const handleMouseDown = (header: any, e: React.MouseEvent) => {
    setIsResizing(true);
    header.getResizeHandler()(e);
  };

  const handleMouseUp = () => {
    setIsResizing(false);
    if (clickTimeoutRef.current !== null) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
  };

  const handleSortIconClick = (header: any) => {
    if (header.column.columnDef.enableSorting === false) {
      return;
    }
    if (!isResizing && onSortChange) {
      const currentPinning = table.getState().columnPinning;

      onSortChange(header.column.id);

      setTimeout(() => {
        setColumnPinning(currentPinning);
      }, 0);
    }
  };

  // Scroll to selected row only after the correct page is loaded and the row is present
  useEffect(() => {
    if (
      scrollToSelectedRow &&
      selectedCaseId != null &&
      !hasScrolledToSelected
    ) {
      const row = document.querySelector(
        `[data-row-id="${selectedCaseId}"]`
      ) as HTMLElement | null;
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        setHasScrolledToSelected(true);
      }
    }
  }, [
    scrollToSelectedRow,
    selectedCaseId,
    localData,
    hasScrolledToSelected,
    router,
    pathname,
  ]);

  // Reset scroll flag if selectedCaseId changes
  useEffect(() => {
    setHasScrolledToSelected(false);
  }, [selectedCaseId]);

  // Cleanup resize timeout on unmount
  useEffect(() => {
    return () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, []);

  const groupingActive = !!(grouping && grouping.length > 0);

  if (!data) {
    return null;
  }

  // While loading, render skeleton rows in the SAME table/header so the header
  // (surface, grips, resize handles) matches the loaded state exactly — no
  // separate skeleton layout that drifts from the real one.
  const skeletonRows = Array.from({
    length: typeof pageSize === "number" ? pageSize : 10,
  }).map((_, index) => (
    <TableRow key={`skeleton-${index}`} className={tableStyles.rowDivider}>
      {table.getVisibleLeafColumns().map((column) => (
        <TableCell
          key={String(column.id)}
          style={getCommonPinningStyles(column)}
          className={`${tableStyles.cell} px-2 ${
            column.getIsPinned() ? `shadow-md ${tableStyles.rowSurface}` : ""
          }`}
        >
          <Skeleton className="h-6 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));

  // Sticky pinned columns overlay the scrollport edges, so a bare
  // scrollIntoView (keyboard focus, find-in-page, test runners) can land a
  // mid-table cell underneath them where it cannot receive pointer events.
  // scroll-padding sized to the pinned widths makes the browser scroll such
  // targets into the UNCOVERED region instead.
  const leftPinnedWidth = table
    .getLeftVisibleLeafColumns()
    .reduce((sum, column) => sum + column.getSize(), 0);
  const rightPinnedWidth = table
    .getRightVisibleLeafColumns()
    .reduce((sum, column) => sum + column.getSize(), 0);

  const tableElement = (
    <div
      className="flex flex-col overflow-x-auto rounded-lg border-2 border-primary/10 w-fit max-w-full"
      style={{
        scrollPaddingInlineStart: leftPinnedWidth
          ? `${leftPinnedWidth}px`
          : undefined,
        scrollPaddingInlineEnd: rightPinnedWidth
          ? `${rightPinnedWidth}px`
          : undefined,
      }}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <Table
        // table-fixed (not auto): a resizable/pinned/column-selectable table
        // must honor each column's configured width. Under table-layout:auto the
        // browser sizes a column to its max-content and treats the width as a
        // mere minimum, so a wide-content column (e.g. long case names) ignores
        // getSize() and can't be dragged narrower — intermittently, since it
        // depends on reflow timing. Fixed layout makes widths deterministic and
        // lets the cell overflow-hidden wrappers truncate.
        className="caption-bottom text-sm w-full table-fixed border-separate border-spacing-y-0"
        data-testid="case-table"
      >
        <TableHeader className="[&_tr]:border-b">
          {(() => {
            const reorderableColumnIds = enableColumnReorder
              ? table
                  .getVisibleLeafColumns()
                  .filter((c) => !c.getIsPinned())
                  .map((c) => c.id)
              : [];
            const headerRows = table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className={`transition-colors ${tableStyles.headerRow}`}
              >
                {headerGroup.headers
                  .filter((header) => {
                    // Filter headers using the same logic as visibleColumns
                    if (Object.keys(effectiveColumnVisibility).length > 0) {
                      if (header.column.columnDef.enableHiding === false) {
                        return true;
                      }
                      return (
                        effectiveColumnVisibility[header.column.id] === true
                      );
                    }
                    // Still initializing (parent visibility empty)
                    if (Object.keys(columnVisibility).length === 0) {
                      const column = header.column.columnDef;
                      if (column.enableHiding === false) {
                        return true;
                      }
                      if (
                        header.column.id === finalColumns[0]?.id ||
                        header.column.id ===
                          finalColumns[finalColumns.length - 1]?.id
                      ) {
                        return true;
                      }
                      const metaVisible = (column.meta as CustomColumnMeta)
                        ?.isVisible;
                      if (metaVisible === false) {
                        return false;
                      }
                      return true;
                    }
                    return true;
                  })
                  .map((header) => {
                    const contentProps = {
                      header,
                      sortConfig,
                      onSortIconClick: handleSortIconClick,
                      onResizeMouseDown: handleMouseDown,
                      onGroupingChange,
                      onSortColumn,
                      onHideColumn,
                      enableColumnMenu,
                    };
                    if (enableColumnReorder && !header.column.getIsPinned()) {
                      return (
                        <SortableHeadCell
                          key={String(header.id)}
                          {...contentProps}
                        />
                      );
                    }
                    return (
                      <TableHead
                        key={String(header.id)}
                        style={getCommonPinningStyles(header.column)}
                        className={getHeadCellClassName(header, sortConfig)}
                      >
                        <HeadCellContent {...contentProps} />
                      </TableHead>
                    );
                  })}
              </TableRow>
            ));
            if (!enableColumnReorder) return headerRows;
            // Only SortableContext goes inside <thead> — it renders no DOM. The
            // DndContext (which renders a hidden a11y <div>) wraps the whole
            // table below, so it isn't an invalid child of <thead>.
            return (
              <SortableContext
                items={reorderableColumnIds}
                strategy={horizontalListSortingStrategy}
              >
                {headerRows}
              </SortableContext>
            );
          })()}
        </TableHeader>
        <TableBody className="[&_tr:last-child]:border-0">
          {showSkeleton
            ? skeletonRows
            : table.getRowModel().rows.map((row, index) => {
                const isSelected = selectedCaseId === row.original.id;
                const depth = row.depth;
                const isGrouped = row.getIsGrouped();
                const isSubRow = depth > 0;

                // Use SortableItem when enableReorder is true and not a grouped row
                if (enableReorder && !isGrouped && onReorder) {
                  // Ensure row data conforms to SortableItem's expected type
                  const sortableRow = {
                    ...row,
                    original: {
                      ...row.original,
                      folderId: row.original.folderId ?? null, // Convert undefined to null
                      name: row.original.name ?? "",
                    },
                  };

                  return (
                    <SortableItem
                      key={row.id}
                      id={row.id}
                      row={sortableRow}
                      index={index}
                      // Table-ordered (reflects columnOrder + pinning + visibility)
                      // so reorderable rows stay aligned with the header, which
                      // renders in table order.
                      visibleColumns={table.getVisibleLeafColumns()}
                      canDragTestCase={true}
                      onReorder={onReorder}
                      cellPinningStyleFn={getCommonPinningStyles}
                      selectedItemsForDrag={selectedItemsForDragFinal}
                      itemType={itemType}
                      selectedRowId={selectedCaseId}
                      scrollToSelectedRow={scrollToSelectedRow}
                    />
                  );
                }

                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className={`${onTestCaseClick ? "cursor-pointer" : "cursor-default"} ${tableStyles.rowDivider} ${
                      isSelected
                        ? "bg-primary/20 hover:bg-primary/30 border-4 border-primary"
                        : isSubRow
                          ? tableStyles.rowSurfaceNested
                          : isGrouped
                            ? "bg-accent font-semibold"
                            : tableStyles.rowSurface
                    }`}
                    data-row-id={row.original.id}
                    data-testid={`${rowTestIdPrefix}-${row.original.id}`}
                    onClick={() => {
                      if (onTestCaseClick && !isGrouped) {
                        onTestCaseClick(row.original.id);
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const { column } = cell;
                      const cellContent = resolveGroupableCellContent(
                        cell,
                        row,
                        groupingActive,
                        tActions
                      );
                      return (
                        <TableCell
                          key={String(column.id)}
                          data-column-id={String(column.id)}
                          style={getCommonPinningStyles(column)}
                          // Only a pinned cell needs its own fill, to hide the
                          // cells scrolling under it — the row's own surface, or for
                          // a selected row the opaque equivalent of its primary/20
                          // tint so the highlight covers the pinned column too.
                          // Everything else stays transparent so the row surface
                          // shows through; this path renders whenever reorder is
                          // off, e.g. while sorted.
                          className={`${tableStyles.cell} px-2 ${
                            column.getIsPinned()
                              ? isSelected
                                ? "shadow-md bg-[color-mix(in_srgb,var(--color-primary)_36%,var(--color-background))]"
                                : `shadow-md ${isSubRow ? "table-row-surface-nested" : "table-row-surface"}`
                              : isSelected
                                ? "bg-primary/20"
                                : ""
                          } ${
                            column.id === "expander" ||
                            (column.getIsPinned() &&
                              !column.getIsLastColumn(
                                column.getIsPinned() as "left" | "right"
                              ))
                              ? "border-e-0"
                              : "border-e"
                          }`}
                        >
                          {/* Cells truncate to a single line by default so long
                              raw text doesn't wrap and grow the row — the user
                              widens the column to see more. A column opts out
                              with `meta: { wrap: true }`. The fixed table
                              layout gives the cell its rendered width, so the
                              wrapper carries no width of its own — content may
                              use all the space a stretched column actually
                              has, not just the configured `size`. */}
                          {(column.columnDef.meta as CustomColumnMeta)?.wrap ? (
                            cellContent
                          ) : (
                            <div className="truncate">{cellContent}</div>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
          {!showSkeleton &&
            table.getRowModel().rows.length === 0 &&
            !isLoading && (
              <TableRow>
                <TableCell
                  colSpan={visibleColumns.length}
                  className="h-12 text-center text-muted-foreground"
                >
                  {emptyMessage ?? tLabels("noResults")}
                </TableCell>
              </TableRow>
            )}
        </TableBody>
      </Table>
    </div>
  );

  if (!enableColumnReorder) return tableElement;

  // The DndContext wraps the whole table (not the <thead>) because it renders a
  // hidden accessibility <div> that would be an invalid child of <thead>.
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
