"use client";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import {
  Cell,
  Column,
  ColumnDef,
  ColumnOrderState,
  ColumnPinningState,
  flexRender,
  OnChangeFn,
  Row,
  SortingState,
  Updater,
} from "@tanstack/react-table";
import {
  ArrowDownAZ,
  ArrowDownUp,
  ArrowUpZA,
  Check,
  ChevronRight,
  EyeOff,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../ui/button";
import {
  readStoredColumnOrder,
  writeStoredColumnOrder,
} from "./ColumnSelection";

/**
 * Internals shared by the two render engines of `DataTable` (the paged
 * `<table>` engine and the virtualized flex-row engine). Nothing here is part
 * of the public API — consumers import from `./DataTable`.
 */

/** Minimal row shape the table understands. `name` is only consulted by the
 * paged engine's row drag-reorder (drag preview label). */
export interface DataRow {
  id: number | string;
  name?: string;
  folderId?: number | null;
  isActive?: boolean;
  [key: string]: any;
}

export interface CustomColumnMeta {
  isVisible?: boolean;
  isPinned?: "left" | "right";
  /** Opt a column out of the default single-line truncation so its cells wrap. */
  wrap?: boolean;
  /**
   * Hold this column in its declared position while the rest stay
   * drag-reorderable. For a table that renders a TREE, the column carrying
   * the chevrons and the indent is load-bearing: the nesting guide is
   * painted from the row's own start, so moving that column elsewhere would
   * leave the guide marking one column and the chevron sitting in another.
   * Pinning would also hold a column still, but it freezes it against
   * horizontal scroll as well, which is a different (and much heavier)
   * decision.
   */
  noReorder?: boolean;
  /**
   * Rendered INSIDE the header cell but AFTER (as a sibling of) the
   * column-menu trigger button. The header content itself lives inside that
   * trigger `<button>`, so any interactive header adornment (a popover, a
   * legend) MUST come through this slot instead of the `header` renderer --
   * nesting a button inside the trigger is invalid HTML and breaks the sort
   * menu (requirements list UAT).
   */
  headerExtra?: ReactNode;
}

export type SortConfig = { column: string; direction: "asc" | "desc" };

/** One nesting level's indent, in px, applied by `RowExpanderPrefix`. Matches
 *  the step the requirements list uses for its own tree. */
export const NESTING_INDENT_PX = 24;

/** The chevron slot's width, in px — reserved on every row whether or not it
 *  can expand, so text keeps one origin. `h-5 w-5` in class form. */
export const EXPANDER_SLOT_PX = 20;

export function shallowEqualRecord(
  a: Record<string, boolean>,
  b: Record<string, boolean>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length && bKeys.every((key) => a[key] === b[key])
  );
}

/**
 * Merge a stored column order with the columns present now: keep stored ids that
 * still exist (in their saved order), then splice any new id in after its
 * nearest preceding natural neighbour. Falls back to the natural order when
 * nothing usable is stored. Exported (via `DataTable`) for unit testing.
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

/**
 * Sticky-column CSS for the paged `<table>` engine. Carries the column's
 * width/min/max (a `<td>` needs them inline under `table-fixed`) and a z-index
 * that lifts pinned cells above the resize separators (`z-20`), which otherwise
 * paint on top of them: reorderable non-pinned headers drop their stacking
 * context when idle, so their handles compete globally and would bleed over the
 * pinned column as it stays put while other columns scroll under it.
 */
export const getCommonPinningStyles = (column: Column<any>): CSSProperties => {
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
    zIndex: isPinned ? 21 : 0,
  };
};

/**
 * Sticky-column CSS for the virtualized flex-row engine. Only applied when the
 * caller opts in via `enableColumnPinning`; returns `{}` for unpinned columns.
 * The pinned cell also needs an opaque background (applied via className) so
 * horizontally scrolled content doesn't bleed through. Width is set by the
 * engine's flex sizing, not here.
 */
export function getFlexPinningStyles(column: Column<any, any>): CSSProperties {
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
 * Convert the caller's `sortConfig` into TanStack's controlled sorting state,
 * ignoring a stale sort that points at a column the current set lacks, plus the
 * change handler that funnels TanStack's updater back into `onSortChange`.
 */
export function useSortingAdapter(
  sortConfig: SortConfig | null | undefined,
  onSortChange: ((columnId: string) => void) | undefined,
  columns: ColumnDef<any, any>[]
): { sorting: SortingState; handleSortingChange: OnChangeFn<SortingState> } {
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

  return { sorting, handleSortingChange };
}

/**
 * The expand/collapse chevron for a row with sub-rows, rendered INLINE at the
 * head of the first content cell.
 *
 * This replaced a dedicated `expander` column prepended to every nesting
 * table. That column was wrong twice over. It was sized to a 24px well while
 * the virtualized engine gives every cell `px-3` — a ONE PIXEL content box
 * under `overflow: hidden`, which clipped the chevron to 13 of its 16px (the
 * literal "▶" it used to render is ~10px and squeaked through, so the
 * clipping stayed invisible until the glyph was replaced with the app's
 * standard icon). And on a GROUPED row it drew a second chevron beside the
 * one `resolveGroupableCellContent` already renders in the grouped cell, so
 * every grouping table showed two.
 *
 * Inline is also what the requirements list does with its own tree chevron,
 * so the two nesting surfaces in this app now work the same way.
 *
 * Renders a same-sized SPACER rather than nothing when a row cannot expand,
 * so a mixed list of expandable and leaf rows keeps one text origin instead
 * of going ragged. Indents by depth, which the removed column could not do.
 * Deliberately silent on a GROUPED row: that row's own cell already carries
 * a chevron, and this is what stops it doubling.
 */
export function RowExpanderPrefix<TData>({
  row,
  subRowsLabel,
}: {
  row: Row<TData>;
  subRowsLabel?: string;
}) {
  const tActions = useTranslations("common.actions");
  const canExpand = row.getCanExpand() && !row.getIsGrouped();
  const isExpanded = row.getIsExpanded();
  const subRowsCount = row.subRows?.length ?? 0;
  const tooltipText = isExpanded
    ? tActions("collapse")
    : `${tActions("expand")}${subRowsLabel && subRowsCount > 0 ? ` • ${subRowsCount} ${subRowsLabel}` : ""}`;

  return (
    <span
      className="me-1 flex shrink-0 items-center"
      style={{ paddingInlineStart: row.depth * NESTING_INDENT_PX }}
    >
      {canExpand ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={row.getToggleExpandedHandler()}
                style={{ cursor: "pointer" }}
                className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={tooltipText}
                data-testid="row-expander"
              >
                {/* The rotation lives on this span as an inline transform,
                    not as a `rotate-90` class on the icon: the class form
                    sets the standalone `rotate` property, and only a node
                    that survives the toggle animates either way. */}
                <span
                  className="inline-flex items-center justify-center transition-transform duration-200"
                  style={{
                    transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  }}
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{tooltipText}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span className="h-5 w-5 shrink-0" aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * Seed the left/right pin sets once from `meta.isPinned`, then let TanStack own
 * the state.
 *
 * `autoPinFirstLast` (the virtualized engine's default behaviour): when the
 * caller pinned nothing, freeze the first and last columns to the table edges,
 * with the auto-added expander riding along on the left. `alwaysPinExpander`
 * (the paged engine's behaviour): pin the expander whenever it is present, even
 * alongside explicit `meta.isPinned` columns.
 */
export function useInitialColumnPinning({
  columns,
  grouping,
  getSubRows,
  enabled = true,
  autoPinFirstLast = false,
  alwaysPinExpander = false,
}: {
  columns: ColumnDef<any, any>[];
  grouping?: string[];
  getSubRows?: (row: any, index: number) => any[] | undefined;
  enabled?: boolean;
  autoPinFirstLast?: boolean;
  alwaysPinExpander?: boolean;
}): [ColumnPinningState, Dispatch<SetStateAction<ColumnPinningState>>] {
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({
    left: [],
    right: [],
  });
  const initialPinningDone = useRef(false);

  useEffect(() => {
    if (!enabled || initialPinningDone.current) return;
    const left: string[] = [];
    const right: string[] = [];
    for (const column of columns) {
      const pin = (column.meta as CustomColumnMeta | undefined)?.isPinned;
      const id = column.id as string;
      if (pin === "left") left.push(id);
      else if (pin === "right") right.push(id);
    }
    const hasExpander = !!(grouping && grouping.length > 0) || !!getSubRows;
    if (
      autoPinFirstLast &&
      left.length === 0 &&
      right.length === 0 &&
      columns.length > 1
    ) {
      const firstId = columns[0]?.id as string | undefined;
      const lastId = columns[columns.length - 1]?.id as string | undefined;
      if (firstId) left.push(firstId);
      if (hasExpander) left.unshift("expander");
      if (lastId && lastId !== firstId) right.push(lastId);
    } else if (alwaysPinExpander && hasExpander) {
      left.unshift("expander");
    }
    setColumnPinning({ left, right });
    initialPinningDone.current = true;
  }, [
    enabled,
    autoPinFirstLast,
    alwaysPinExpander,
    columns,
    grouping,
    getSubRows,
  ]);

  return [columnPinning, setColumnPinning];
}

/**
 * Column drag-reorder state shared by both engines: TanStack `columnOrder`
 * hydrated once from localStorage (under ColumnSelection's
 * `testplanit:columnOrder:` namespace), reconciled whenever the column set
 * changes (so a template/report switch keeps the user's arrangement of
 * still-present columns), and written back on every completed drag. The
 * dnd-kit sensors use a 5px activation distance so a plain click (sort) or a
 * resize-handle drag never starts a column drag.
 */
export function usePersistedColumnOrder({
  enabled,
  storageKey,
  finalColumns,
}: {
  enabled: boolean;
  storageKey?: string;
  finalColumns: ColumnDef<any, any>[];
}): {
  columnOrder: ColumnOrderState;
  setColumnOrder: Dispatch<SetStateAction<ColumnOrderState>>;
  handleColumnDragEnd: (event: DragEndEvent) => void;
  columnDragSensors: ReturnType<typeof useSensors>;
} {
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  // Hydrate in an effect so the server render (no localStorage) and the first
  // client render match.
  const didHydrate = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const natural = finalColumns.map((c) => c.id as string);
    if (!didHydrate.current) {
      didHydrate.current = true;
      setColumnOrder(
        reconcileColumnOrder(natural, readStoredColumnOrder(storageKey))
      );
      return;
    }
    setColumnOrder((prev) =>
      reconcileColumnOrder(natural, prev.length > 0 ? prev : null)
    );
  }, [enabled, storageKey, finalColumns]);

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

  return {
    columnOrder,
    setColumnOrder,
    handleColumnDragEnd,
    columnDragSensors,
  };
}

/**
 * Resolve what a body cell renders under grouping: the group lead cell gets an
 * expand toggle + label + member count, aggregated cells render their
 * `aggregatedCell` (falling back to `cell`), placeholder cells render nothing,
 * and everything else renders its plain cell. Identical branch logic for both
 * engines; only gated on `groupingActive` so ungrouped tables never pay for it
 * (see feedback: gate grouped branches on groupingActive).
 */
export function resolveGroupableCellContent(
  cell: Cell<any, unknown>,
  row: Row<any>,
  groupingActive: boolean,
  tActions: (key: string) => string
): ReactNode {
  if (groupingActive && cell.getIsGrouped()) {
    // Only show the member count if there's no custom aggregatedCell (which
    // handles its own display).
    const showCount = !cell.column.columnDef.aggregatedCell;
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          onClick={row.getToggleExpandedHandler()}
          style={{ cursor: "pointer" }}
          className="me-1 p-1"
          aria-label={
            row.getIsExpanded() ? tActions("collapse") : tActions("expand")
          }
        >
          {/* Same chevron as the sub-row expander above -- a grouped row and
              an expandable parent row are the same gesture and must not look
              like two different ones. */}
          <span
            className="inline-flex items-center justify-center w-4 transition-transform duration-200"
            style={{
              transform: row.getIsExpanded() ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </Button>
        {flexRender(cell.column.columnDef.cell, cell.getContext())}
        {showCount ? ` (${row.subRows.length})` : null}
      </div>
    );
  }
  if (groupingActive && cell.getIsAggregated()) {
    return flexRender(
      cell.column.columnDef.aggregatedCell ?? cell.column.columnDef.cell,
      cell.getContext()
    );
  }
  if (groupingActive && cell.getIsPlaceholder()) {
    return null;
  }
  return flexRender(cell.column.columnDef.cell, cell.getContext());
}

/**
 * The items of the per-column header menu, shared by both engines: explicit
 * sort direction (asc / desc / remove) and Hide column. Rendered inside a
 * `DropdownMenuContent` the engine supplies. Hide is only offered when the
 * column can be hidden AND an `onHideColumn` owner is wired to apply it (so
 * persistence + the Columns control stay in sync — see the visibility
 * single-owner rule).
 */
export function ColumnMenuItems({
  columnId,
  isSortable,
  canHide,
  isActiveSort,
  sortDirection,
  onSortColumn,
  onHideColumn,
}: {
  columnId: string;
  isSortable: boolean;
  canHide: boolean;
  isActiveSort: boolean;
  sortDirection?: "asc" | "desc";
  onSortColumn?: (columnId: string, direction: "asc" | "desc" | null) => void;
  onHideColumn?: (columnId: string) => void;
}) {
  const t = useTranslations("common.table");
  return (
    <>
      {isSortable && (
        <>
          <DropdownMenuItem
            className="gap-1"
            onSelect={() => onSortColumn?.(columnId, "asc")}
          >
            <ArrowDownAZ className="h-4 w-4" />
            {t("sortAsc")}
            {sortDirection === "asc" && <Check className="ms-auto h-4 w-4" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-1"
            onSelect={() => onSortColumn?.(columnId, "desc")}
          >
            <ArrowUpZA className="h-4 w-4" />
            {t("sortDesc")}
            {sortDirection === "desc" && <Check className="ms-auto h-4 w-4" />}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-1"
            disabled={!isActiveSort}
            onSelect={() => onSortColumn?.(columnId, null)}
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
          onSelect={() => onHideColumn?.(columnId)}
        >
          <EyeOff className="h-4 w-4" />
          {t("hideColumn")}
        </DropdownMenuItem>
      )}
    </>
  );
}

/**
 * Header label that surfaces a native tooltip with the column's full text, but
 * only while that text is actually clipped by the column's width. Works for any
 * header content (a plain string or a render function with icons) by reading the
 * rendered `textContent`, and re-measures on column resize via a ResizeObserver
 * so the tooltip appears/disappears live as the user drags the column narrower
 * or wider.
 */
export function TruncatedHeaderLabel({ children }: { children: ReactNode }) {
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
