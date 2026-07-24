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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Column,
  ColumnDef,
  ColumnOrderState,
  ColumnPinningState,
  ColumnSizingState,
  ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  OnChangeFn,
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
  Check,
  ChevronDown,
  EyeOff,
  Group,
  GripVertical,
  UnfoldVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "~/lib/navigation";
import { Button } from "../ui/button";
import SortableItem from "./SortableItem";
import { tableStyles } from "./tableStyles";
import {
  readStoredColumnOrder,
  readStoredColumnWidths,
  writeStoredColumnOrder,
  writeStoredColumnWidths,
} from "./ColumnSelection";

// Define DataRow to include folderId optionally, required by SortableItem
interface DataRow {
  id: number | string;
  name: string;
  folderId?: number | null; // Add folderId as optional here
  isActive?: boolean;
  [key: string]: any;
}

// Define structure for items passed to SortableItem for drag preview
interface DraggedCaseInfoForSortableItem {
  id: number | string;
  name: string;
}

interface DataTableProps<TData extends DataRow, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
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
  sortConfig?: { column: string; direction: "asc" | "desc" };
  enableReorder?: boolean;
  onReorder?: (dragIndex: number, hoverIndex: number) => void;
  expandedRows?: Set<number | string>;
  handleExpandClick?: (id: number | string) => void;
  renderExpandedRow?: (row: TData) => React.ReactNode;
  columnVisibility: Record<string, boolean>;
  onColumnVisibilityChange: (visibility: Record<string, boolean>) => void;
  relatedFieldKey?: string;
  isLoading?: boolean;
  pageSize?: number;
  onTestCaseClick?: (id: number | string) => void;
  canEdit?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (updater: Updater<RowSelectionState>) => void;
  cellPinningStyleFn?: (column: Column<any>) => CSSProperties;
  selectedItemsForDrag?: DraggedCaseInfoForSortableItem[];
  grouping?: string[];
  onGroupingChange?: OnChangeFn<string[]>;
  expanded?: ExpandedState;
  onExpandedChange?: OnChangeFn<ExpandedState>;
  itemType?: string;
  getSubRows?: (originalRow: TData, index: number) => TData[] | undefined;
  subRowColumns?: ColumnDef<any, any>[];
  subRowsLabel?: string;
  rowTestIdPrefix?: string;
  /** Explicit id of the row to highlight and scroll to. Falls back to the
   * `selectedCase` search param when not provided (e.g. the run page), so the
   * repository details panel can drive it from its own `case` param. */
  selectedRowId?: number | null;
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

interface CustomColumnMeta {
  isVisible?: boolean;
  isPinned?: "left" | "right";
  /** Opt a column out of the default single-line truncation so its cells wrap. */
  wrap?: boolean;
}

// Define this OUTSIDE the component function
const getCommonPinningStyles = (column: Column<any>): CSSProperties => {
  const isPinned = column.getIsPinned();
  const isLastLeftPinnedColumn =
    isPinned === "left" && column.getIsLastColumn("left");
  const isFirstRightPinnedColumn =
    isPinned === "right" && column.getIsFirstColumn("right");

  return {
    boxShadow: isLastLeftPinnedColumn
      ? "4px 0 8px -4px rgba(0,0,0,0.3)"
      : isFirstRightPinnedColumn
        ? "-4px 0 8px -4px rgba(0,0,0,0.3)"
        : undefined,
    left: isPinned === "left" ? `${column.getStart("left")}px` : undefined,
    right: isPinned === "right" ? `${column.getStart("right")}px` : undefined,
    position: isPinned ? "sticky" : "relative",
    width: column.getSize(),
    maxWidth: column.columnDef.maxSize,
    minWidth: column.columnDef.minSize,
    // A pinned column sits above the resize separators (`z-20`), which otherwise
    // paint on top of it: reorderable non-pinned headers drop their stacking
    // context when idle, so their handles compete globally and would bleed over
    // the pinned column as it stays put while other columns scroll under it.
    zIndex: isPinned ? 21 : 0,
  };
};

/**
 * Merge a stored column order with the columns present now: keep stored ids that
 * still exist (in their saved order), then splice any new id in after its
 * nearest preceding natural neighbour. Falls back to the natural order when
 * nothing usable is stored. Exported for unit testing.
 */
export function reconcileColumnOrder(
  natural: string[],
  stored: string[] | null
): string[] {
  if (!stored || stored.length === 0) return natural;
  const naturalSet = new Set(natural);
  const result = stored.filter((id) => naturalSet.has(id));
  const present = new Set(result);
  natural.forEach((id, i) => {
    if (present.has(id)) return;
    // Insert after the nearest preceding natural column already placed.
    let insertAt = 0;
    for (let j = i - 1; j >= 0; j--) {
      const idx = result.indexOf(natural[j]);
      if (idx !== -1) {
        insertAt = idx + 1;
        break;
      }
    }
    result.splice(insertAt, 0, id);
    present.add(id);
  });
  return result;
}

type HeadCellContentProps = {
  header: any;
  sortConfig?: { column: string; direction: "asc" | "desc" };
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
              {isSortable && (
                <>
                  <DropdownMenuItem
                    className="gap-1"
                    onSelect={() => onSortColumn?.(header.column.id, "asc")}
                  >
                    <ArrowDownAZ className="h-4 w-4" />
                    {t("sortAsc")}
                    {sortDirection === "asc" && (
                      <Check className="ms-auto h-4 w-4" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-1"
                    onSelect={() => onSortColumn?.(header.column.id, "desc")}
                  >
                    <ArrowUpZA className="h-4 w-4" />
                    {t("sortDesc")}
                    {sortDirection === "desc" && (
                      <Check className="ms-auto h-4 w-4" />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-1"
                    disabled={!isActiveSort}
                    onSelect={() => onSortColumn?.(header.column.id, null)}
                  >
                    <ArrowDownUp className="h-4 w-4" />
                    {t("removeSort")}
                  </DropdownMenuItem>
                </>
              )}
              {isSortable && canHide && <DropdownMenuSeparator />}
              {canHide && (
                <DropdownMenuItem
                  className="gap-1"
                  onSelect={() => onHideColumn?.(header.column.id)}
                >
                  <EyeOff className="h-4 w-4" />
                  {t("hideColumn")}
                </DropdownMenuItem>
              )}
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
function getHeadCellClassName(
  header: any,
  sortConfig?: { column: string; direction: "asc" | "desc" }
): string {
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
function SortableHeadCell({
  header,
  cellPinningStyleFn,
  ...contentProps
}: HeadCellContentProps & {
  cellPinningStyleFn: (column: Column<any>) => CSSProperties;
}) {
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
    ...cellPinningStyleFn(column),
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

export function DataTable<TData extends DataRow, TValue>({
  columns,
  data,
  onSortChange,
  onSortColumn,
  onHideColumn,
  sortConfig,
  enableReorder,
  onReorder,
  expandedRows = new Set(),
  handleExpandClick,
  renderExpandedRow,
  columnVisibility,
  onColumnVisibilityChange,
  relatedFieldKey: _relatedFieldKey = "variants",
  isLoading = false,
  pageSize = 10,
  onTestCaseClick,
  canEdit: _canEdit = false,
  rowSelection: externalRowSelection,
  onRowSelectionChange: externalOnRowSelectionChange,
  cellPinningStyleFn = getCommonPinningStyles,
  selectedItemsForDrag,
  grouping,
  onGroupingChange,
  expanded,
  onExpandedChange,
  itemType,
  getSubRows,
  subRowColumns: _subRowColumns,
  subRowsLabel,
  rowTestIdPrefix = "case-row",
  selectedRowId,
  scrollToSelectedRow = true,
  storageKey,
  enableColumnReorder = !!storageKey,
  enableColumnMenu = !!storageKey,
}: DataTableProps<TData, TValue>) {
  const tLabels = useTranslations("common.labels");
  const tActions = useTranslations("common.actions");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
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
      setEffectiveColumnVisibility(mergedVisibility);
    } else {
      // Only use getInitialVisibility as fallback when columnVisibility is empty
      setEffectiveColumnVisibility(getInitialVisibility);
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
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({
    left: [],
    right: [],
  });
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

  // Convert sortConfig to SortingState for TanStack Table
  const sorting: SortingState = useMemo(() => {
    if (!sortConfig) return [];

    // Validate that the column exists in the columns array
    const columnExists = columns.some((col) => col.id === sortConfig.column);
    if (!columnExists) {
      console.warn(
        `[DataTable] Ignoring sort config for non-existent column: "${sortConfig.column}"`
      );
      return [];
    }

    return [{ id: sortConfig.column, desc: sortConfig.direction === "desc" }];
  }, [sortConfig, columns]);

  const handleSortingChange = useCallback(
    (updaterOrValue: Updater<SortingState>) => {
      if (!onSortChange) return;

      const newSorting =
        typeof updaterOrValue === "function"
          ? updaterOrValue(sorting)
          : updaterOrValue;

      if (newSorting.length > 0) {
        onSortChange(newSorting[0].id);
      }
    },
    [onSortChange, sorting]
  );

  const [isResizing, setIsResizing] = useState(false);
  const clickTimeoutRef = useRef<number | null>(null);
  const initialPinningDone = useRef(false);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLocalData(data || []);
  }, [data]);

  useEffect(() => {
    if (initialPinningDone.current) {
      return;
    }

    // Initialize column pinning based on column meta properties
    const leftPinned: string[] = [];
    const rightPinned: string[] = [];

    columns.forEach((column) => {
      const columnId = column.id as string;
      const isPinned = (column.meta as any)?.isPinned;

      if (isPinned === "left") {
        leftPinned.push(columnId);
      } else if (isPinned === "right") {
        rightPinned.push(columnId);
      }
    });

    // The auto-added expander column (present when grouping or sub-rows are on)
    // carries its own `isPinned: "left"`, but it isn't part of the `columns`
    // prop above — pin it here so the toggle leads the row at the far left
    // rather than floating between the last left-pinned column and the first
    // center column.
    if ((grouping && grouping.length > 0) || getSubRows) {
      leftPinned.unshift("expander");
    }

    setColumnPinning({
      left: leftPinned,
      right: rightPinned,
    });

    initialPinningDone.current = true;
  }, [columns, grouping, getSubRows]);

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

  // Add expander column if grouping is set
  const expanderColumn: ColumnDef<TData, any> = useMemo(
    () => ({
      id: "expander",
      header: () => null,
      cell: ({ row }) => {
        if (!row.getCanExpand()) return null;
        const isExpanded = row.getIsExpanded();
        const subRowsCount = row.subRows?.length ?? 0;
        const tooltipText = isExpanded
          ? tActions("collapse")
          : `${tActions("expand")}${subRowsLabel && subRowsCount > 0 ? ` \u2022 ${subRowsCount} ${subRowsLabel}` : ""}`;
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={row.getToggleExpandedHandler()}
                  style={{ cursor: "pointer" }}
                  className="me-2"
                  aria-label={tooltipText}
                >
                  <span
                    className="inline-flex items-center justify-center w-4 transition-transform duration-200"
                    style={{
                      transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                    }}
                  >
                    {"\u25B6"}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{tooltipText}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
      size: 24,
      minSize: 24,
      maxSize: 24,
      enableResizing: false,
      enableHiding: false,
      meta: { isPinned: "left" },
    }),
    [tActions, subRowsLabel]
  );
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
      maxSize: 1500, // Max column width (matches VirtualizedDataTable)
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
          name: row.original.name,
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

  // Track leaf row IDs rendered as part of a flattened group (for grouped/expandable rendering)
  const _renderedLeafRowIds = new Set<string | number>();

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
          style={cellPinningStyleFn(column)}
          className={`${tableStyles.cell} px-2 ${
            column.getIsPinned() ? `shadow-md ${tableStyles.rowSurface}` : ""
          }`}
        >
          <Skeleton className="h-6 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));

  const tableElement = (
    <div
      className="flex flex-col overflow-x-auto rounded-lg border-2 border-primary/10 w-fit max-w-full"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <Table
        className="caption-bottom text-sm w-full border-separate border-spacing-y-0"
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
                          cellPinningStyleFn={cellPinningStyleFn}
                          {...contentProps}
                        />
                      );
                    }
                    return (
                      <TableHead
                        key={String(header.id)}
                        style={cellPinningStyleFn(header.column)}
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
                      handleExpandClick={handleExpandClick}
                      expandedRows={expandedRows}
                      renderExpandedRow={
                        renderExpandedRow
                          ? (row: any) => renderExpandedRow(row)
                          : undefined
                      }
                      canDragTestCase={true}
                      onReorder={onReorder}
                      cellPinningStyleFn={cellPinningStyleFn}
                      selectedItemsForDrag={selectedItemsForDragFinal}
                      itemType={itemType}
                      selectedRowId={selectedCaseId}
                      scrollToSelectedRow={scrollToSelectedRow}
                    />
                  );
                }

                return (
                  <React.Fragment key={row.id}>
                    <TableRow
                      data-state={row.getIsSelected() ? "selected" : undefined}
                      className={`${onTestCaseClick || handleExpandClick ? "cursor-pointer" : "cursor-default"} ${tableStyles.rowDivider} ${
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
                        } else if (handleExpandClick && !isGrouped) {
                          handleExpandClick(row.original.id);
                        }
                      }}
                    >
                      {row.getVisibleCells().map((cell, cellIndex) => {
                        const { column } = cell;
                        let cellContent: React.ReactNode = null;
                        const _shouldIndent = cellIndex === 0 && isSubRow;
                        const groupingActive = !!(
                          grouping && grouping.length > 0
                        );

                        if (groupingActive && cell.getIsGrouped()) {
                          // If grouped, show group label and count
                          // Only show count if there's no custom aggregatedCell (which handles its own display)
                          const showCount =
                            !cell.column.columnDef.aggregatedCell;

                          cellContent = (
                            <div className="flex items-center gap-1">
                              <Button
                                {...{
                                  variant: "ghost",
                                  onClick: row.getToggleExpandedHandler(),
                                  style: { cursor: "pointer" },
                                  className: "me-1 p-1",
                                }}
                              >
                                <span
                                  className="inline-flex items-center justify-center w-4 transition-transform duration-200"
                                  style={{
                                    transform: row.getIsExpanded()
                                      ? "rotate(90deg)"
                                      : "rotate(0deg)",
                                  }}
                                >
                                  {"▶"}
                                </span>
                              </Button>
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                              {showCount && (
                                <>
                                  {" "}
                                  {"("}
                                  {row.subRows.length}
                                  {")"}
                                </>
                              )}
                            </div>
                          );
                        } else if (groupingActive && cell.getIsAggregated()) {
                          // If aggregated, show aggregate value
                          cellContent = flexRender(
                            cell.column.columnDef.aggregatedCell ??
                              cell.column.columnDef.cell,
                            cell.getContext()
                          );
                        } else if (groupingActive && cell.getIsPlaceholder()) {
                          cellContent = null;
                        } else {
                          cellContent = flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          );
                        }
                        return (
                          <TableCell
                            key={String(column.id)}
                            data-column-id={String(column.id)}
                            style={cellPinningStyleFn(column)}
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
                                with `meta: { wrap: true }`. maxWidth pins the
                                truncation to the column's width under the table's
                                auto layout. */}
                            {(column.columnDef.meta as CustomColumnMeta)
                              ?.wrap ? (
                              cellContent
                            ) : (
                              <div
                                className="truncate"
                                style={{ maxWidth: column.getSize() }}
                              >
                                {cellContent}
                              </div>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                    {row.getIsExpanded() && renderExpandedRow && (
                      <TableRow className="w-fit">
                        <TableCell
                          colSpan={visibleColumns.length}
                          className="bg-muted/30 w-fit"
                        >
                          {renderExpandedRow(row.original)}
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
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
                  {tLabels("noResults")}
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
