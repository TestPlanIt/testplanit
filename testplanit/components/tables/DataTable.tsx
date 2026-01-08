import React, {
  CSSProperties,
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import {
  ArrowDownUp,
  ArrowUpZA,
  ArrowDownAZ,
  UnfoldVertical,
  Group,
} from "lucide-react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getGroupedRowModel,
  getExpandedRowModel,
  Column,
  ColumnPinningState,
  ColumnSizingState,
  VisibilityState,
  Updater,
  RowSelectionState,
  GroupingState,
  ExpandedState,
  OnChangeFn,
  Row,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import SortableItem from "./SortableItem";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearchParams } from "next/navigation";
import { useRouter, usePathname } from "~/lib/navigation";
import { Button } from "../ui/button";

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
}

interface CustomColumnMeta {
  isVisible?: boolean;
  isPinned?: "left" | "right";
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
    zIndex: isPinned ? 1 : 0,
  };
};

export function DataTable<TData extends DataRow, TValue>({
  columns,
  data,
  onSortChange,
  sortConfig,
  enableReorder,
  onReorder,
  expandedRows = new Set(),
  handleExpandClick,
  renderExpandedRow,
  columnVisibility,
  onColumnVisibilityChange,
  relatedFieldKey = "variants",
  isLoading = false,
  pageSize = 10,
  onTestCaseClick,
  canEdit = false,
  rowSelection: externalRowSelection,
  onRowSelectionChange: externalOnRowSelectionChange,
  cellPinningStyleFn = getCommonPinningStyles,
  selectedItemsForDrag,
  grouping,
  onGroupingChange,
  expanded,
  onExpandedChange,
  itemType,
}: DataTableProps<TData, TValue>) {
  const t = useTranslations("common.table");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selectedCaseId = searchParams.get("selectedCase")
    ? parseInt(searchParams.get("selectedCase")!)
    : null;

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

  const [localData, setLocalData] = useState<TData[]>([]);
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({
    left: [],
    right: [],
  });
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [internalRowSelection, setInternalRowSelection] =
    useState<RowSelectionState>({});
  const rowSelection = externalRowSelection ?? internalRowSelection;
  const onRowSelectionChange =
    externalOnRowSelectionChange ?? setInternalRowSelection;
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

    setColumnPinning({
      left: leftPinned,
      right: rightPinned,
    });

    initialPinningDone.current = true;
  }, [columns]);

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
      }, 1); // 1ms debounce
    },
    [columnSizing]
  );

  // Add expander column if grouping is set
  const expanderColumn: ColumnDef<TData, any> = useMemo(
    () => ({
      id: "expander",
      header: () => null,
      cell: ({ row }) =>
        row.getCanExpand() ? (
          <button
            {...{
              onClick: row.getToggleExpandedHandler(),
              style: { cursor: "pointer" },
              className: "mr-2",
            }}
          >
            <span
              className="inline-flex items-center justify-center w-4 transition-transform duration-200"
              style={{ transform: row.getIsExpanded() ? 'rotate(90deg)' : 'rotate(0deg)' }}
              aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
            >
              {"\u25B6"}
            </span>
          </button>
        ) : null,
      size: 24,
      minSize: 24,
      maxSize: 24,
      enableResizing: false,
      enableHiding: false,
      meta: { isPinned: "left" },
    }),
    []
  );
  const finalColumns = useMemo(() => {
    if (grouping && grouping.length > 0) {
      return [expanderColumn, ...columns];
    }
    return columns;
  }, [columns, grouping, expanderColumn]);

  const table = useReactTable({
    data: localData,
    columns: finalColumns,
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel:
      grouping && grouping.length > 0 ? getGroupedRowModel() : undefined,
    getExpandedRowModel:
      grouping && grouping.length > 0 ? getExpandedRowModel() : undefined,
    enableColumnPinning: true,
    enableColumnResizing: true,
    enableRowSelection: true,
    state: {
      columnPinning,
      columnSizing,
      columnVisibility: effectiveColumnVisibility,
      rowSelection,
      grouping: grouping ?? [],
      expanded: expanded ?? {},
    },
    onGroupingChange,
    onExpandedChange,
    onRowSelectionChange: onRowSelectionChange,
    onColumnSizingChange: handleColumnSizingChange,
    onColumnPinningChange: setColumnPinning,
    onColumnVisibilityChange: handleVisibilityChange,
    defaultColumn: {
      minSize: 50, // Min column width
      maxSize: 500, // Max column width
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
    if (selectedCaseId != null && !hasScrolledToSelected) {
      const row = document.querySelector(
        `[data-row-id="${selectedCaseId}"]`
      ) as HTMLElement | null;
      if (row) {
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        setHasScrolledToSelected(true);
      }
    }
  }, [selectedCaseId, localData, hasScrolledToSelected, router, pathname]);

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
  const renderedLeafRowIds = new Set<string | number>();

  if (showSkeleton) {
    return (
      <div className="rounded-md border h-full">
        <Table>
          <TableHeader>
            <TableRow>
              {enableReorder && <TableHead className="w-[30px]" />}
              {table
                .getHeaderGroups()[0]
                ?.headers.filter((header) => {
                  // Filter headers using the same logic as visibleColumns
                  if (Object.keys(effectiveColumnVisibility).length > 0) {
                    // Always show columns that cannot be hidden
                    if (header.column.columnDef.enableHiding === false) {
                      return true;
                    }
                    return effectiveColumnVisibility[header.column.id] === true;
                  }

                  // If columnVisibility from parent is empty, we're still initializing
                  if (Object.keys(columnVisibility).length === 0) {
                    const column = header.column.columnDef;
                    // Always show columns that cannot be hidden
                    if (column.enableHiding === false) {
                      return true;
                    }
                    // Always show first and last columns
                    if (
                      header.column.id === finalColumns[0]?.id ||
                      header.column.id ===
                        finalColumns[finalColumns.length - 1]?.id
                    ) {
                      return true;
                    }
                    // Check meta visibility - if explicitly set to false, hide the column
                    const metaVisible = (column.meta as CustomColumnMeta)
                      ?.isVisible;
                    if (metaVisible === false) {
                      return false;
                    }
                    // Default to showing columns that don't have isVisible set
                    return true;
                  }

                  // Fallback to showing all headers
                  return true;
                })
                .map((header) => (
                  <TableHead key={header.id} className="select-none">
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </TableHead>
                ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: pageSize }).map((_, index) => (
              <TableRow key={index}>
                {enableReorder && (
                  <TableCell>
                    <Skeleton className="h-8 w-4" />
                  </TableCell>
                )}
                {visibleColumns.map((column, colIndex) => (
                  <TableCell key={String(column.id)}>
                    <Skeleton
                      className={`h-8 ${colIndex === 0 ? "w-[500px]" : "w-full"}`}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div
      className="flex flex-col overflow-x-auto rounded-lg border-2 border-primary/10 w-fit max-w-full"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <Table className="caption-bottom text-sm w-full border-separate border-spacing-y-0" data-testid="case-table">
        <TableHeader className="[&_tr]:border-b">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted shadow-xs bg-accent"
            >
              {headerGroup.headers
                .filter((header) => {
                  // Filter headers using the same logic as visibleColumns
                  if (Object.keys(effectiveColumnVisibility).length > 0) {
                    // Always show columns that cannot be hidden
                    if (header.column.columnDef.enableHiding === false) {
                      return true;
                    }
                    return effectiveColumnVisibility[header.column.id] === true;
                  }

                  // If columnVisibility from parent is empty, we're still initializing
                  if (Object.keys(columnVisibility).length === 0) {
                    const column = header.column.columnDef;
                    // Always show columns that cannot be hidden
                    if (column.enableHiding === false) {
                      return true;
                    }
                    // Always show first and last columns
                    if (
                      header.column.id === finalColumns[0]?.id ||
                      header.column.id ===
                        finalColumns[finalColumns.length - 1]?.id
                    ) {
                      return true;
                    }
                    // Check meta visibility - if explicitly set to false, hide the column
                    const metaVisible = (column.meta as CustomColumnMeta)
                      ?.isVisible;
                    if (metaVisible === false) {
                      return false;
                    }
                    // Default to showing columns that don't have isVisible set
                    return true;
                  }

                  // Fallback to showing all headers
                  return true;
                })
                .map((header) => {
                  const { column } = header;
                  const isSortable = header.column.columnDef.enableSorting;
                  const isActiveSort = sortConfig?.column === header.column.id;
                  const sortDirection = isActiveSort
                    ? sortConfig.direction
                    : undefined;
                  return (
                    <TableHead
                      key={String(header.id)}
                      style={cellPinningStyleFn(column)}
                      className={`select-none ${column.getIsPinned() ? "bg-primary-foreground" : "bg-primary-foreground/80"}`}
                    >
                      <div
                        className={`flex gap-2 items-center justify-between relative ${isActiveSort ? "font-extrabold" : ""}`}
                      >
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          {/* Grouping toggle button */}
                          {header.column.getCanGroup() && onGroupingChange ? (
                            <button
                              onClick={header.column.getToggleGroupingHandler()}
                              style={{ cursor: "pointer" }}
                              className="mr-1"
                              title={
                                header.column.getIsGrouped()
                                  ? "Ungroup"
                                  : "Group by this column"
                              }
                            >
                              {header.column.getIsGrouped() ? (
                                <UnfoldVertical
                                  className="inline h-4 w-4"
                                  aria-label="Grouped"
                                />
                              ) : (
                                <Group
                                  className="inline h-4 w-4"
                                  aria-label="Group"
                                />
                              )}
                            </button>
                          ) : null}
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {isSortable && (
                            <div
                              onClick={() => handleSortIconClick(header)}
                              className="ml-1 cursor-pointer"
                              aria-label={t("sort")}
                              role="button"
                            >
                              {isActiveSort ? (
                                sortDirection === "asc" ? (
                                  <ArrowDownAZ
                                    className="h-4 w-4"
                                    aria-label={t("sortAscending")}
                                  />
                                ) : sortDirection === "desc" ? (
                                  <ArrowUpZA
                                    className="h-4 w-4"
                                    aria-label={t("sortDescending")}
                                  />
                                ) : (
                                  <ArrowDownUp
                                    className="h-4 w-4"
                                    aria-label={t("sortNone")}
                                  />
                                )
                              ) : (
                                <ArrowDownUp
                                  className="h-4 w-4"
                                  aria-label={t("sortNone")}
                                />
                              )}
                            </div>
                          )}
                        </div>
                        {header.column.getCanResize() && (
                          <div
                            onDoubleClick={() => header.column.resetSize()}
                            onMouseDown={(e) => handleMouseDown(header, e)}
                            onTouchStart={header.getResizeHandler()}
                            className={`absolute right-[-14px] h-full top-0 w-2 cursor-col-resize select-none touch-none ${
                              header.column.getIsResizing()
                                ? "bg-primary/50"
                                : "hover:bg-primary/20"
                            }`}
                            aria-label={t("resize")}
                          >
                            <div className="h-full w-px bg-primary/30" />
                          </div>
                        )}
                      </div>
                    </TableHead>
                  );
                })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className="[&_tr:last-child]:border-0">
          {table.getRowModel().rows.map((row, index) => {
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
                  visibleColumns={visibleColumns}
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
                />
              );
            }

            return (
              <React.Fragment key={row.id}>
                <TableRow
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className={`${onTestCaseClick || handleExpandClick ? "cursor-pointer" : "cursor-default"} ${
                    isSelected
                      ? "bg-primary/20 hover:bg-primary/30 border-4 border-primary"
                      : isSubRow
                        ? "bg-muted/5 hover:bg-muted/20"
                        : isGrouped
                          ? "bg-accent font-semibold"
                          : "hover:bg-muted/50"
                  }`}
                  data-row-id={row.original.id}
                  data-testid={`case-row-${row.original.id}`}
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
                    const shouldIndent = cellIndex === 0 && isSubRow;

                    if (cell.getIsGrouped()) {
                      // If grouped, show group label and count
                      cellContent = (
                        <div className="flex items-center gap-1">
                          <Button
                            {...{
                              variant: "ghost",
                              onClick: row.getToggleExpandedHandler(),
                              style: { cursor: "pointer" },
                              className: "mr-1 p-1",
                            }}
                          >
                            <span
                              className="inline-flex items-center justify-center w-4 transition-transform duration-200"
                              style={{ transform: row.getIsExpanded() ? 'rotate(90deg)' : 'rotate(0deg)' }}
                            >
                              {"▶"}
                            </span>
                          </Button>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}{" "}
                          {"("}
                          {row.subRows.length}
                          {")"}
                        </div>
                      );
                    } else if (cell.getIsAggregated()) {
                      // If aggregated, show aggregate value
                      cellContent = flexRender(
                        cell.column.columnDef.aggregatedCell ??
                          cell.column.columnDef.cell,
                        cell.getContext()
                      );
                    } else if (cell.getIsPlaceholder()) {
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
                        style={cellPinningStyleFn(column)}
                        className={`${column.getIsPinned() ? "bg-background shadow-md" : isSelected ? "bg-primary/20" : "bg-primary-foreground/80"} ${
                          column.getIsPinned() &&
                          !column.getIsLastColumn(
                            column.getIsPinned() as "left" | "right"
                          )
                            ? "border-r-0"
                            : "border-r border-accent"
                        }`}
                      >
                        {/* Render content directly like SortableItem does to preserve cell alignment */}
                        {cellContent}
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
        </TableBody>
      </Table>
    </div>
  );
}
