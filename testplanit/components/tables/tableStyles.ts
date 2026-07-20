/**
 * Styles shared by the two data tables.
 *
 * `DataTable` renders a real <table> (needed for drag-to-reorder rows and
 * pinned columns) while `VirtualizedDataTable` renders divs with table roles,
 * so they cannot share a component — but they present the same visual language.
 * Edit these tokens and both tables follow.
 *
 * The colour of the grid lines lives in `.table-row-divider` in globals.css: it
 * sets a `--table-grid-line` custom property that colours both axes, because
 * row borders are not painted in the border-separate model `DataTable` uses.
 */
export const tableStyles = {
  /** Header row: the strip behind the column titles. */
  headerRow: "border-b bg-muted-foreground/20 text-foreground",

  /**
   * Header cell: column title. Vertical rhythm and type only — horizontal
   * padding stays with each table, whose first column is sized differently.
   */
  headerCell: "py-2 text-xs font-medium",

  /**
   * Body cell. `min-h-10` sets the row rhythm at 40px + 1px divider regardless
   * of what a consumer puts in the actions column, while still letting a row
   * grow for taller content; `self-stretch` makes the flex cells of
   * VirtualizedDataTable fill that height so their column separators run the
   * full height of the row (a <td> stretches on its own and ignores it).
   *
   * Horizontal padding is deliberately NOT here: the sortable table's first
   * column is a 50px well holding a drag grip and a checkbox, and wider padding
   * clips them.
   */
  cell: "min-h-10 self-stretch py-1 align-middle text-sm",

  /** Row divider + column separators (see `.table-row-divider` in globals.css). */
  rowDivider: "table-row-divider",

  /** Resting fill for a normal row, plus its hover state. */
  rowSurface: "table-row-surface table-row-surface-hover",

  /** Resting fill for a nested/detail sub-row, plus its hover state. */
  rowSurfaceNested: "table-row-surface-nested table-row-surface-nested-hover",
} as const;
