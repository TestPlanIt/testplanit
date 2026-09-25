import {
  aggregationFn_count,
  aggregationFn_extent,
  aggregationFn_sum,
  aggregationFn_unique,
  columnGroupingFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper as createTanStackColumnHelper,
  createExpandedRowModel,
  createGroupedRowModel,
  createSortedRowModel,
  rowAggregationFeature,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  type Cell as TanStackCell,
  type CellContext as TanStackCellContext,
  type Column as TanStackColumn,
  type ColumnDef as TanStackColumnDef,
  type Header as TanStackHeader,
  type HeaderContext as TanStackHeaderContext,
  type Row as TanStackRow,
  type RowData,
  type Table as TanStackTable,
} from "@tanstack/react-table";

/**
 * The feature set shared by every app table (DataTable, the virtualized
 * engine, and the column definitions passed to them). The `auto` sort and
 * aggregation functions only resolve names registered here, so the built-ins
 * that v8 picked automatically stay registered.
 */
export const dataTableFeatures = tableFeatures({
  columnVisibilityFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnResizingFeature,
  rowSortingFeature,
  rowSelectionFeature,
  rowExpandingFeature,
  rowAggregationFeature,
  columnGroupingFeature,
  sortedRowModel: createSortedRowModel(),
  groupedRowModel: createGroupedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  aggregationFns: {
    count: aggregationFn_count,
    extent: aggregationFn_extent,
    sum: aggregationFn_sum,
    unique: aggregationFn_unique,
  },
});

export type DataTableFeatures = typeof dataTableFeatures;

export type ColumnDef<
  TData extends RowData,
  TValue = unknown,
> = TanStackColumnDef<DataTableFeatures, TData, TValue>;
export type Column<TData extends RowData, TValue = unknown> = TanStackColumn<
  DataTableFeatures,
  TData,
  TValue
>;
export type Row<TData extends RowData> = TanStackRow<DataTableFeatures, TData>;
export type Cell<TData extends RowData, TValue = unknown> = TanStackCell<
  DataTableFeatures,
  TData,
  TValue
>;
export type Header<TData extends RowData, TValue = unknown> = TanStackHeader<
  DataTableFeatures,
  TData,
  TValue
>;
export type Table<TData extends RowData> = TanStackTable<
  DataTableFeatures,
  TData
>;
export type CellContext<
  TData extends RowData,
  TValue = unknown,
> = TanStackCellContext<DataTableFeatures, TData, TValue>;
export type HeaderContext<
  TData extends RowData,
  TValue = unknown,
> = TanStackHeaderContext<DataTableFeatures, TData, TValue>;

export const createColumnHelper = <TData extends RowData>() =>
  createTanStackColumnHelper<DataTableFeatures, TData>();

export {
  flexRender,
  type ColumnOrderState,
  type ColumnPinningState,
  type ColumnSizingState,
  type ExpandedState,
  type GroupingState,
  type OnChangeFn,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Updater,
  type ColumnVisibilityState as VisibilityState,
} from "@tanstack/react-table";
