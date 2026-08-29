import { ColumnDef } from "@tanstack/react-table";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "~/test/test-utils";
import { DataTable, type VirtualizedDataTableProps } from "./DataTable";

// The real hook owns TanStack Virtual + an IntersectionObserver, neither of
// which produces layout (or fires) under jsdom. Replace it with a pass-through
// that renders every flattened row and captures the latest `onLoadMore` so a
// test can simulate the sentinel firing. The hook has its own unit test for the
// observer wiring (hooks/useVirtualizedInfiniteList.test.tsx).
const hookMock = vi.hoisted(() => ({
  lastOnLoadMore: null as null | (() => void),
  lastOpts: null as Record<string, unknown> | null,
  scrollToIndex: vi.fn(),
}));

vi.mock("~/hooks/useVirtualizedInfiniteList", () => ({
  useVirtualizedInfiniteList: (opts: {
    count: number;
    onLoadMore: () => void;
  }) => {
    hookMock.lastOnLoadMore = opts.onLoadMore;
    hookMock.lastOpts = opts as unknown as Record<string, unknown>;
    return {
      scrollRef: () => {},
      sentinelRef: { current: null },
      virtualizer: { scrollToIndex: hookMock.scrollToIndex },
      virtualItems: Array.from({ length: opts.count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 44,
        size: 44,
        end: (i + 1) * 44,
        lane: 0,
      })),
      totalSize: opts.count * 44,
      measureElement: () => {},
      maxHeight: null,
    };
  },
}));

// Bare-key i18n mock (namespace-agnostic) — matches the pattern used by other
// component tests so we can assert on stable label keys.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

interface RowShape {
  id: number;
  name: string;
  count: number;
  subRows?: RowShape[];
}

const baseColumns: ColumnDef<RowShape, any>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ getValue }) => String(getValue()),
    enableGrouping: true,
  },
  {
    id: "count",
    accessorKey: "count",
    header: "Count",
    cell: ({ getValue }) => String(getValue()),
  },
];

function renderTable(overrides: Partial<VirtualizedDataTableProps<any>> = {}) {
  const props: VirtualizedDataTableProps<any> = {
    virtualized: true,
    columns: baseColumns as ColumnDef<any, any>[],
    data: [
      { id: 1, name: "Alpha", count: 10 },
      { id: 2, name: "Beta", count: 20 },
    ],
    columnVisibility: {},
    onColumnVisibilityChange: vi.fn(),
    onSortChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<DataTable {...props} />) };
}

describe("DataTable (virtualized mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookMock.lastOnLoadMore = null;
    hookMock.lastOpts = null;
    hookMock.scrollToIndex.mockClear();
  });

  it("renders the header and every row (no pagination slicing)", () => {
    renderTable();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Count")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    // The whole result set is handed to the virtualizer.
    expect(hookMock.lastOpts?.count).toBe(2);
  });

  it("adds a title tooltip to a header only when its label is clipped", () => {
    // jsdom reports 0 for layout, so fake a header whose content (scrollWidth)
    // overflows its box (clientWidth); the label should expose its full text as
    // a native tooltip.
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(500);
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(100);
    try {
      renderTable();
      expect(screen.getByText("Name")).toHaveAttribute("title", "Name");
    } finally {
      scrollWidth.mockRestore();
      clientWidth.mockRestore();
    }
  });

  it("omits the header tooltip when the label fits within its column", () => {
    // Content fits its box (scrollWidth === clientWidth) — no tooltip needed.
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(100);
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(100);
    try {
      renderTable();
      expect(screen.getByText("Name")).not.toHaveAttribute("title");
    } finally {
      scrollWidth.mockRestore();
      clientWidth.mockRestore();
    }
  });

  it("calls onSortChange with the column id when a sort control is clicked", () => {
    const onSortChange = vi.fn();
    renderTable({ onSortChange });
    // First sortable column is "name".
    const sortButtons = screen.getAllByLabelText("sort");
    fireEvent.click(sortButtons[0]);
    expect(onSortChange).toHaveBeenCalledWith("name");
  });

  it("renders an empty state when there are no rows", () => {
    renderTable({ data: [] });
    expect(screen.getByText("noResults")).toBeInTheDocument();
  });

  it("passes onLoadMore through to the infinite-scroll hook (server-paged mode)", () => {
    const onLoadMore = vi.fn();
    renderTable({ hasMore: true, isLoading: false, onLoadMore });
    expect(typeof hookMock.lastOnLoadMore).toBe("function");
    act(() => hookMock.lastOnLoadMore?.());
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("passes loadedCount equal to the visible count for a plain (non-rollup) table", () => {
    renderTable({ hasMore: true, onLoadMore: vi.fn() });
    // Two flat rows, no rollup: the load-more signal matches the visible count.
    expect(hookMock.lastOpts?.count).toBe(2);
    expect(hookMock.lastOpts?.loadedCount).toBe(2);
  });

  it("derives loadedCount from the full row tree so collapsed rollups keep paginating", () => {
    renderTable({
      hasMore: true,
      onLoadMore: vi.fn(),
      data: [
        {
          id: 1,
          name: "Parent",
          count: 1,
          subRows: [
            { id: 11, name: "c1", count: 0 },
            { id: 12, name: "c2", count: 0 },
            { id: 13, name: "c3", count: 0 },
          ],
        },
      ],
      getSubRows: (row: RowShape) => row.subRows,
    });
    // Collapsed by default → one visible row...
    expect(hookMock.lastOpts?.count).toBe(1);
    // ...but the load-more signal counts the parent + all rolled-up children,
    // so a fetched page that collapses entirely into this parent still advances
    // pagination (the systemic fix for the giant-collapsed-group stall).
    expect(hookMock.lastOpts?.loadedCount).toBe(4);
  });

  // `getRowNestingDepth` exists for a table that flattens its own tree (the
  // requirements list): TanStack's `row.depth` is 0 on every row of a flat
  // array, so without it a child row is indistinguishable from a root and the
  // shared nested-row surface never paints.
  it("reads nesting depth from getRowNestingDepth when the table supplies its own depth", () => {
    renderTable({
      data: [
        { id: 1, name: "Root", count: 0, depth: 0 },
        { id: 2, name: "Child", count: 0, depth: 1 },
      ] as any,
      getRowNestingDepth: (row) => (row.original as { depth: number }).depth,
    });

    const root = screen.getByTestId("virtualized-row-1");
    const child = screen.getByTestId("virtualized-row-2");
    expect(child.className).toContain("table-row-surface-nested");
    expect(root.className).not.toContain("table-row-surface-nested");
  });

  // An expansion-based sub-row gets a guide without the consumer asking for
  // one, derived from its own indent depth. This used to be a `border-e-4` on
  // a dedicated expander column's cell, which had stopped rendering as a
  // primary bar at all -- the nested-row CSS repaints every border on a nested
  // cell with the softened divider tint.
  it("derives a nesting guide offset from the first column for an expansion sub-row", () => {
    renderTable({
      data: [
        {
          id: 1,
          name: "Parent",
          count: 0,
          subRows: [{ id: 11, name: "Child", count: 0 }],
        },
      ],
      getSubRows: (row: RowShape) => row.subRows,
      expanded: true,
    });

    const guides = screen.getAllByTestId("virtualized-nesting-guide");
    // The sub-row gets one; the parent does not.
    expect(guides).toHaveLength(1);
    // The cell's own 12px `px-3` plus one 24px indent level: the rule marks
    // the indent the sub-row was pushed over by, with the chevron slot still
    // clear between it and the text.
    expect(guides[0].getAttribute("style")).toContain("36px");
  });

  it("gives a root row no nesting guide", () => {
    renderTable({
      data: [{ id: 1, name: "Root", count: 0 }],
    });
    expect(
      screen.queryByTestId("virtualized-nesting-guide")
    ).not.toBeInTheDocument();
  });

  it("leaves nesting on row.depth when getRowNestingDepth is absent, so existing tables are untouched", () => {
    renderTable({
      data: [
        { id: 1, name: "Root", count: 0, depth: 0 },
        { id: 2, name: "Child", count: 0, depth: 1 },
      ] as any,
    });

    // A `depth` field the engine was never told to read must not change how
    // any row paints.
    expect(screen.getByTestId("virtualized-row-2").className).not.toContain(
      "table-row-surface-nested"
    );
  });

  it("lets an explicit loadedCount prop override the derived tree count", () => {
    renderTable({
      hasMore: true,
      onLoadMore: vi.fn(),
      loadedCount: 999,
      data: [
        {
          id: 1,
          name: "Parent",
          count: 1,
          subRows: [{ id: 11, name: "c1", count: 0 }],
        },
      ],
      getSubRows: (row: RowShape) => row.subRows,
    });
    expect(hookMock.lastOpts?.loadedCount).toBe(999);
  });

  it("shows the load-more indicator while appending a page", () => {
    renderTable({ hasMore: true, isLoading: true });
    expect(
      screen.getByTestId("virtualized-table-loading-more")
    ).toBeInTheDocument();
  });

  it("surfaces a retry control when a load-more fetch failed", () => {
    const onRetryLoadMore = vi.fn();
    renderTable({ loadMoreError: true, onRetryLoadMore });
    const retry = screen.getByTestId("virtualized-table-load-more-retry");
    fireEvent.click(retry);
    expect(onRetryLoadMore).toHaveBeenCalledTimes(1);
  });

  it("renders an expander for rows that have sub-rows (execution-log shape)", () => {
    renderTable({
      data: [
        {
          id: 1,
          name: "Parent",
          count: 1,
          subRows: [{ id: 11, name: "Step", count: 0 }],
        },
      ],
      getSubRows: (row: RowShape) => row.subRows,
      subRowsLabel: "steps",
    });
    // The expander column renders an expand control for the expandable parent.
    expect(screen.getByText("Parent")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/expand/).length).toBeGreaterThan(0);
  });

  it("renders a drag-to-resize handle on each resizable column", () => {
    renderTable();
    expect(
      screen.getByTestId("virtualized-table-resize-name")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("virtualized-table-resize-count")
    ).toBeInTheDocument();
  });

  it("renders a resize handle on the flex column", () => {
    renderTable({ flexColumnId: "name", enableColumnPinning: false });
    expect(
      screen.getByTestId("virtualized-table-resize-name")
    ).toBeInTheDocument();
  });

  it("does not render a resize handle on the non-resizable expander column", () => {
    renderTable({ grouping: ["name"] });
    // The expander column opts out via enableResizing:false.
    expect(
      screen.queryByTestId("virtualized-table-resize-expander")
    ).not.toBeInTheDocument();
  });

  it("scrolls the virtualizer to a deep-linked row once it's in the set", () => {
    renderTable({ scrollToRowId: 2 });
    // "Beta" (id 2) is the second row → index 1.
    expect(hookMock.scrollToIndex).toHaveBeenCalledWith(1, { align: "center" });
  });

  it("does not scroll when the deep-linked row isn't present", () => {
    renderTable({ scrollToRowId: 999 });
    expect(hookMock.scrollToIndex).not.toHaveBeenCalled();
  });

  it("draws a highlight ring on the deep-linked row's overlay, not the row's own box (gap closure 26.2-15 moved the outline off the row)", () => {
    renderTable({ highlightRowId: 1 });
    const highlighted = screen
      .getByText("Alpha")
      .closest('[role="row"]') as HTMLElement;
    const ring = highlighted.querySelector(
      '[data-testid="virtualized-row-1-ring"]'
    ) as HTMLElement;
    expect(ring).toBeInTheDocument();
    expect(ring.className).toContain("outline-primary");
    // The row itself only carries the translucent tint now.
    expect(highlighted.className).toContain("bg-primary/10");
    expect(highlighted.className).not.toContain("outline-primary");
    // The other row is not highlighted -- no overlay at all.
    const other = screen
      .getByText("Beta")
      .closest('[role="row"]') as HTMLElement;
    expect(
      other.querySelector('[data-testid="virtualized-row-2-ring"]')
    ).not.toBeInTheDocument();
  });

  it("keeps the highlight ring fully inside the row so the scroll container's clip edge can't shave it (a ring edge clipped by the scroll container)", () => {
    renderTable({ highlightRowId: 1 });
    const highlighted = screen
      .getByText("Alpha")
      .closest('[role="row"]') as HTMLElement;
    const ring = highlighted.querySelector(
      '[data-testid="virtualized-row-1-ring"]'
    ) as HTMLElement;
    // outline-4 with -outline-offset-4 draws the ring entirely inside the
    // overlay's own border box (which exactly covers the row via inset-0).
    // -outline-offset-2 left 2px bleeding outside the box, which the
    // absolutely-positioned row's clipping scroll container shaved off the
    // start/end edges.
    expect(ring.className).toContain("-outline-offset-4");
    expect(ring.className).not.toContain("-outline-offset-2");
  });

  it("renders the ring overlay pointer-events-none with a z-index class above the pinned cell's -- jsdom can't compute real paint order, so this pins the MECHANISM: the pinned cell's own z-index (2, set inline by getFlexPinningStyles in dataTableShared.tsx) is a fixed, known constant strictly below the overlay's z-20", () => {
    renderTable({ highlightRowId: 1 });
    const row1 = screen.getByTestId("virtualized-row-1");
    const ring = row1.querySelector(
      '[data-testid="virtualized-row-1-ring"]'
    ) as HTMLElement;
    expect(ring.className).toContain("pointer-events-none");
    expect(ring.className).toContain("z-20");

    // Default pinning (pinFirstLast) freezes the last column ("count") right.
    const pinnedCell = row1.querySelector(
      '[data-column-id="count"]'
    ) as HTMLElement;
    expect(pinnedCell.style.zIndex).toBe("2");
  });

  it("composes a consumer's ringClassName with the built-in highlight ring on the SAME overlay, and renders the overlay even without highlightRowId when only ringClassName is supplied", () => {
    renderTable({
      highlightRowId: 1,
      getRowProps: (row) =>
        row.original.id === 1
          ? { ringClassName: "drag-ring-test" }
          : { ringClassName: "drag-ring-test-2" },
    });
    const row1 = screen.getByTestId("virtualized-row-1");
    const ring1 = row1.querySelector(
      '[data-testid="virtualized-row-1-ring"]'
    ) as HTMLElement;
    expect(ring1.className).toContain("outline-primary");
    expect(ring1.className).toContain("drag-ring-test");

    // Row 2 is not highlighted, but its own ringClassName alone still mounts
    // the overlay (the candidate-row ring must render without a selection).
    const row2 = screen.getByTestId("virtualized-row-2");
    const ring2 = row2.querySelector(
      '[data-testid="virtualized-row-2-ring"]'
    ) as HTMLElement;
    expect(ring2).toBeInTheDocument();
    expect(ring2.className).toContain("drag-ring-test-2");
    expect(ring2.className).not.toContain("outline-primary");
  });

  it("mounts no ring overlay at all for a plain row (no highlight, no ringClassName)", () => {
    renderTable();
    const row1 = screen.getByTestId("virtualized-row-1");
    expect(
      row1.querySelector('[data-testid="virtualized-row-1-ring"]')
    ).not.toBeInTheDocument();
  });

  it("shows drag-to-reorder grips on non-pinned columns when the table persists state", () => {
    renderTable({
      columnSizingStorageKey: "reorder-key",
      enableColumnPinning: false,
    });
    expect(screen.getAllByLabelText("reorderColumn")).toHaveLength(2);
  });

  it("keeps grips off pinned columns", () => {
    // Default pinning freezes the first and last columns — with only two
    // columns both are pinned, so no grips render.
    renderTable({ columnSizingStorageKey: "reorder-key" });
    expect(screen.queryByLabelText("reorderColumn")).not.toBeInTheDocument();
  });

  it("renders no grips for a stateless table (no storage key)", () => {
    renderTable({ enableColumnPinning: false });
    expect(screen.queryByLabelText("reorderColumn")).not.toBeInTheDocument();
  });

  it("applies a remembered column order from localStorage", () => {
    window.localStorage.setItem(
      "testplanit:columnOrder:reorder-key",
      JSON.stringify(["count", "name"])
    );
    try {
      renderTable({
        columnSizingStorageKey: "reorder-key",
        enableColumnPinning: false,
      });
      const headerCells = screen.getAllByRole("columnheader");
      expect(headerCells[0].textContent).toContain("Count");
      expect(headerCells[1].textContent).toContain("Name");
    } finally {
      window.localStorage.removeItem("testplanit:columnOrder:reorder-key");
    }
  });

  it("renders no header column menu when no menu handler is wired", () => {
    renderTable();
    expect(screen.queryByLabelText("columnOptions")).not.toBeInTheDocument();
    // The plain sort-cycle buttons remain.
    expect(screen.getAllByLabelText("sort").length).toBeGreaterThan(0);
  });

  it("offers explicit sort directions through the header column menu", () => {
    const onSortColumn = vi.fn();
    renderTable({ onSortColumn, enableColumnPinning: false });
    const triggers = screen.getAllByLabelText("columnOptions");
    expect(triggers).toHaveLength(2);
    // The cycling sort button is replaced by the menu trigger.
    expect(screen.queryByLabelText("sort")).not.toBeInTheDocument();
    fireEvent.pointerDown(triggers[0]);
    fireEvent.click(screen.getByText("sortDesc"));
    expect(onSortColumn).toHaveBeenCalledWith("name", "desc");
  });

  it("routes Hide column through onHideColumn", () => {
    const onHideColumn = vi.fn();
    renderTable({ onHideColumn, enableColumnPinning: false });
    const triggers = screen.getAllByLabelText("columnOptions");
    fireEvent.pointerDown(triggers[1]);
    fireEvent.click(screen.getByText("hideColumn"));
    expect(onHideColumn).toHaveBeenCalledWith("count");
  });

  it("seeds column widths from localStorage when a storage key is set", () => {
    window.localStorage.setItem(
      "vdt:colsize:my-key",
      JSON.stringify({ name: 275 })
    );
    renderTable({ columnSizingStorageKey: "my-key" });
    const nameHeader = screen
      .getAllByRole("columnheader")
      .find((el) => el.textContent?.includes("Name"));
    expect(nameHeader).toBeDefined();
    expect(nameHeader).toHaveStyle({ width: "275px" });
    window.localStorage.removeItem("vdt:colsize:my-key");
  });
});

describe("DataTable (virtualized mode) — getRowProps row extension point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookMock.lastOnLoadMore = null;
    hookMock.lastOpts = null;
    hookMock.scrollToIndex.mockClear();
  });

  it("applies the className getRowProps returns for a given row, and only that row", () => {
    renderTable({
      getRowProps: (row) => ({
        className: row.original.id === 2 ? "ring-test" : undefined,
      }),
    });
    const row2 = screen.getByTestId("virtualized-row-2");
    const row1 = screen.getByTestId("virtualized-row-1");
    expect(row2.className).toContain("ring-test");
    expect(row1.className).not.toContain("ring-test");
  });

  it("composes the consumer className with the highlightRowId treatment instead of replacing it", () => {
    renderTable({
      highlightRowId: 2,
      getRowProps: (row) =>
        row.original.id === 2 ? { className: "ring-test" } : undefined,
    });
    const row2 = screen.getByTestId("virtualized-row-2");
    expect(row2.className).toContain("bg-primary/10");
    expect(row2.className).toContain("ring-test");
  });

  it("leaves a row's class list unchanged when getRowProps returns undefined for it", () => {
    const { container } = renderTable({
      getRowProps: () => undefined,
    });
    const row1 = screen.getByTestId("virtualized-row-1");
    expect(row1.className).not.toContain("undefined");
    void container;
  });

  it("fires onDragEnter supplied through getRowProps with the row's own DOM node as currentTarget", () => {
    // The native DOM event's currentTarget is only live during dispatch, so it
    // must be read synchronously inside the handler — reading it back off
    // `mock.calls` afterward observes it already reset to null.
    let observedCurrentTarget: EventTarget | null = null;
    const onDragEnter = vi.fn((event: React.DragEvent<HTMLDivElement>) => {
      observedCurrentTarget = event.currentTarget;
    });
    renderTable({
      getRowProps: (row) =>
        row.original.id === 2 ? { onDragEnter } : undefined,
    });
    const row2 = screen.getByTestId("virtualized-row-2");
    fireEvent.dragEnter(row2);
    expect(onDragEnter).toHaveBeenCalledTimes(1);
    expect(observedCurrentTarget).toBe(row2);
  });

  it("fires onClick supplied through getRowProps", () => {
    const onClick = vi.fn();
    renderTable({
      getRowProps: (row) => (row.original.id === 1 ? { onClick } : undefined),
    });
    fireEvent.click(screen.getByTestId("virtualized-row-1"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("passes a TanStack Row (not the raw data object) to getRowProps", () => {
    const getRowProps = vi.fn().mockReturnValue(undefined);
    renderTable({ getRowProps });
    expect(getRowProps).toHaveBeenCalled();
    const rowArg = getRowProps.mock.calls[0][0];
    expect(rowArg.original.id).toBeDefined();
    expect(typeof rowArg.getIsGrouped).toBe("function");
  });

  it("renders rows identically to today when getRowProps is omitted (regression guard)", () => {
    renderTable();
    const row1 = screen.getByTestId("virtualized-row-1");
    const row2 = screen.getByTestId("virtualized-row-2");
    expect(row1.className).not.toContain("undefined");
    expect(row2.className).not.toContain("undefined");
    expect(row1).toBeInTheDocument();
    expect(row2).toBeInTheDocument();
  });
});
