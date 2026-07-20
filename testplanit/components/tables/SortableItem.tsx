import { TableCell, TableRow } from "@/components/ui/table";
import { Column, flexRender } from "@tanstack/react-table";
import { useSearchParams } from "next/navigation";
import React, { CSSProperties, useEffect, useRef, useState } from "react";
import { DropTargetMonitor, useDrag, useDrop, XYCoord } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { useDragTargetKind } from "~/hooks/useDragTargetKind";
import { ItemTypes } from "~/types/dndTypes";
import { tableStyles } from "./tableStyles";

// Structure for individual items within draggedItems array
interface DraggedCaseInfo {
  id: number | string;
  name: string;
}

// Updated structure for the item being dragged
interface TestCaseDragOperationItem {
  id?: number | string; // Primary item's id, if applicable
  folderId?: number | null; // Primary item's folderId
  name?: string; // Primary item's name
  index: number; // Index of the primary dragged row, crucial for reordering
  draggedItems?: DraggedCaseInfo[]; // Array of all items being dragged
}

function SortableItem<
  TData extends { id: number | string; folderId: number | null; name: string },
>({
  id: _id,
  row,
  index,
  visibleColumns,
  handleExpandClick,
  expandedRows,
  renderExpandedRow,
  canDragTestCase,
  onReorder,
  cellPinningStyleFn,
  selectedItemsForDrag,
  itemType = ItemTypes.TEST_CASE,
  selectedRowId,
  scrollToSelectedRow = true,
}: {
  id: string;
  row: any;
  index: number;
  visibleColumns: any[];
  handleExpandClick?: (id: number | string) => void;
  expandedRows?: Set<number | string>;
  renderExpandedRow?: (row: TData) => React.ReactNode;
  canDragTestCase: boolean;
  onReorder: (dragIndex: number, hoverIndex: number) => void;
  cellPinningStyleFn: (column: Column<any>) => CSSProperties;
  selectedItemsForDrag?: DraggedCaseInfo[];
  itemType?: string;
  selectedRowId?: number | null;
  scrollToSelectedRow?: boolean;
}) {
  const [hoverPosition, setHoverPosition] = useState<"top" | "bottom" | null>(
    null
  );
  const { setIsOverReorderZone } = useDragTargetKind();
  const searchParams = useSearchParams();
  const selectedCaseId =
    selectedRowId ??
    (searchParams.get("selectedCase")
      ? parseInt(searchParams.get("selectedCase")!)
      : null);
  const isSelected = selectedCaseId === row.original.id;

  const rowRef = useRef<HTMLTableRowElement>(null);

  const [{ isDragging }, drag, dragPreview] = useDrag<
    TestCaseDragOperationItem,
    void,
    { isDragging: boolean }
  >(
    () => ({
      type: itemType,
      item: () => {
        const primaryItem = {
          id: row.original.id as number | string,
          folderId: row.original.folderId as number | null,
          name: row.original.name as string,
          index,
          // Add icon and color data if this is a workflow
          ...(itemType === ItemTypes.WORKFLOW && {
            icon: row.original.icon,
            color: row.original.color,
          }),
        };

        // Check if the current row is part of a multi-select drag
        const isCurrentRowSelected = selectedItemsForDrag?.some(
          (item) => item.id === primaryItem.id
        );

        // LOGGING: See what is being sent as the drag item
        // console.log("[DRAG] primaryItem:", primaryItem);
        // console.log("[DRAG] selectedItemsForDrag:", selectedItemsForDrag);
        // console.log("[DRAG] isCurrentRowSelected:", isCurrentRowSelected);

        if (
          selectedItemsForDrag &&
          selectedItemsForDrag.length > 0 &&
          isCurrentRowSelected
        ) {
          const dragItem = {
            ...primaryItem, // Include primary item details (id, folderId, name, index)
            draggedItems: selectedItemsForDrag,
          };
          // console.log("[DRAG] Returning multi-select dragItem:", dragItem);
          return dragItem;
        } else {
          const dragItem = {
            ...primaryItem,
            draggedItems: [
              {
                id: primaryItem.id,
                name: primaryItem.name,
                // Include icon and color for workflows
                ...(itemType === ItemTypes.WORKFLOW && {
                  icon: row.original.icon,
                  color: row.original.color,
                }),
              },
            ],
          };
          // console.log("[DRAG] Returning single dragItem:", dragItem);
          return dragItem;
        }
      },
      canDrag: () => canDragTestCase,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
      end: () => {
        setHoverPosition(null);
      },
    }),
    [
      row.original.id,
      row.original.folderId,
      row.original.name,
      index,
      canDragTestCase,
      selectedItemsForDrag,
    ]
  );

  const [{ handlerId, isOverCurrent }, drop] = useDrop<
    TestCaseDragOperationItem,
    void,
    { handlerId: string | symbol | null; isOverCurrent: boolean }
  >(
    () => ({
      accept: itemType,
      collect(monitor) {
        return {
          handlerId: monitor.getHandlerId(),
          isOverCurrent: monitor.isOver({ shallow: true }),
        };
      },
      hover(
        item: TestCaseDragOperationItem,
        monitor: DropTargetMonitor<TestCaseDragOperationItem, void>
      ) {
        const dragIndex = item.index;
        const hoverIndex = index;

        if (!rowRef.current || !monitor.isOver({ shallow: true })) {
          setHoverPosition(null);
          return;
        }

        if (dragIndex === hoverIndex) {
          setHoverPosition(null);
          return;
        }

        const hoverBoundingRect = rowRef.current.getBoundingClientRect();
        const hoverMiddleY =
          (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
        const clientOffset = monitor.getClientOffset();
        if (!clientOffset) return;
        const hoverClientY =
          (clientOffset as XYCoord).y - hoverBoundingRect.top;

        if (hoverClientY < hoverMiddleY) {
          setHoverPosition("top");
        } else {
          setHoverPosition("bottom");
        }
      },
      drop: (item: TestCaseDragOperationItem, _monitor) => {
        const dragIndex = item.index;
        const hoverIndex = index;

        if (dragIndex === hoverIndex && hoverPosition === null) {
          setHoverPosition(null);
          return;
        }

        if (dragIndex !== hoverIndex || hoverPosition !== null) {
          let targetDropIndex = hoverIndex;
          if (hoverPosition === "bottom") {
            // When dropping at the bottom of a row, we want to insert after that row
            // Always add 1 to place after the hovered item
            targetDropIndex = hoverIndex + 1;
          }
          // When hoverPosition === "top", targetDropIndex stays as hoverIndex
          // which means insert before the hovered item
          onReorder(dragIndex, targetDropIndex);
        }
        setHoverPosition(null);
      },
    }),
    [index, onReorder, hoverPosition]
  );

  useEffect(() => {
    if (!isOverCurrent) {
      setHoverPosition(null);
    }
  }, [isOverCurrent]);

  useEffect(() => {
    if (isOverCurrent) {
      setIsOverReorderZone(true);
      return () => setIsOverReorderZone(false);
    }
  }, [isOverCurrent, setIsOverReorderZone]);

  useEffect(() => {
    dragPreview(getEmptyImage(), { captureDraggingState: true });
  }, [dragPreview]);

  useEffect(() => {
    if (scrollToSelectedRow && isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isSelected, scrollToSelectedRow]);

  useEffect(() => {
    drag(drop(rowRef));
  }, [drag, drop]);

  const style: React.CSSProperties = {
    position: "relative",
    opacity: isDragging ? 0.3 : 1,
    cursor: canDragTestCase ? "grab" : "default",
  };

  // Helper function to generate TableCell class names
  const getCellClassName = (
    cell: any,
    isSelected: boolean,
    _cellPinningStyleFn: (column: Column<any>) => CSSProperties
  ) => {
    const isPinned = cell.column.getIsPinned();
    const classes = [
      "relative",
      "z-10",
      tableStyles.cell,
      "px-2",
      "border-e",
      "whitespace-nowrap",
    ];

    // Apply background based on pinned status first
    if (isPinned && isSelected) {
      // Pinned cells are sticky and need an OPAQUE background so cells scrolling
      // underneath don't show through. Use the opaque equivalent of the selected
      // row's translucent primary/20 tint (the row's /20 plus the cell's /20
      // composite to ~36% over the background) so the highlight covers the
      // pinned column too.
      classes.push(
        "bg-[color-mix(in_srgb,var(--color-primary)_36%,var(--color-background))] border-e-0"
      );
    } else if (isPinned) {
      // Unselected: the same opaque surface as the row, so the pinned column
      // reads as part of the row while still hiding cells scrolling under it.
      classes.push("table-row-surface border-e-0");
    } else if (isSelected) {
      classes.push("bg-primary/20 border-e-0"); // Apply selection highlight if not pinned
    }
    // If not pinned and not selected, the background is inherited from the TableRow

    return classes.join(" ");
  };

  return (
    <>
      <TableRow
        ref={rowRef}
        style={style}
        className={`
          relative
          border-b table-row-divider
          data-[state=selected]:bg-muted
          ${isDragging ? "cursor-grabbing" : ""}
          ${isSelected ? "bg-primary/20 hover:bg-primary/20" : "table-row-surface table-row-surface-hover"}
          transition-opacity duration-100 ease-in-out
        `}
        data-row-id={row.original.id}
        data-testid={`case-row-${row.original.id}`}
        data-handler-id={handlerId}
        onClick={(_e) => {
          if (!isDragging) {
            handleExpandClick?.(row.original.id);
          }
        }}
      >
        {/* Iterate over the visibleColumns prop to ensure order matches header */}
        {visibleColumns.map((column: any, colIndex: number) => {
          // Find the corresponding cell from the row object using the column id
          const cell = row
            .getVisibleCells()
            .find((c: any) => c.column.id === column.id);

          // Skip rendering if cell not found for some reason
          if (!cell) {
            console.warn("Cell not found for column:", column.id);
            return null;
          }

          const _isActionCell = cell.column.id === "actions";

          // Get base pinning styles
          let cellStyle = cellPinningStyleFn(cell.column);

          // If this is the first cell and a drop indicator is active (top or bottom),
          // increase its z-index to ensure it (and its w-screen indicator)
          // are above other cells in the same row.
          const isFirstColumn = colIndex === 0;
          if (
            isFirstColumn &&
            (hoverPosition === "top" || hoverPosition === "bottom")
          ) {
            // Ensure this cell's stacking context is above sibling cells.
            // Sticky cells might have zIndex: 1, non-sticky zIndex: 0.
            // zIndex: 2 should be sufficient.
            cellStyle = { ...cellStyle, zIndex: 2 };
          }

          return (
            <TableCell
              key={cell.id} // Use cell.id from the found cell
              data-column-id={String(cell.column.id)}
              onClick={
                cell.column.id === "actions"
                  ? (e) => e.stopPropagation()
                  : undefined
              }
              style={cellStyle} // Apply potentially modified style
              className={getCellClassName(cell, isSelected, cellPinningStyleFn)}
            >
              {/* Conditionally render indicator INSIDE the first cell */}
              {isFirstColumn && hoverPosition === "top" && (
                <div
                  // Position relative to cell, stretch horizontally, place at top
                  className="absolute top-0 h-[3px] bg-primary z-50 pointer-events-none w-screen"
                  aria-hidden="true"
                />
              )}
              {/* Indicator for BOTTOM */}
              {isFirstColumn && hoverPosition === "bottom" && (
                <div
                  className="absolute bottom-0 h-[3px] bg-primary z-50 pointer-events-none w-screen -my-1"
                  aria-hidden="true"
                />
              )}

              {/* Always render the cell content directly */}
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          );
        })}
      </TableRow>

      {expandedRows?.has(row.original.id) && renderExpandedRow && (
        <TableRow className="w-fit">
          <TableCell
            colSpan={visibleColumns.length}
            className="bg-muted/30 w-fit"
          >
            {renderExpandedRow(row.original)}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default SortableItem;
