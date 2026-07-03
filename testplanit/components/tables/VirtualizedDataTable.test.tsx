import { ColumnDef } from "@tanstack/react-table";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "~/test/test-utils";
import { VirtualizedDataTable } from "./VirtualizedDataTable";

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

function renderTable(
  overrides: Partial<React.ComponentProps<typeof VirtualizedDataTable>> = {}
) {
  const props: React.ComponentProps<typeof VirtualizedDataTable> = {
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
  return { props, ...render(<VirtualizedDataTable {...props} />) };
}

describe("VirtualizedDataTable", () => {
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

  it("draws a highlight ring on the deep-linked row", () => {
    renderTable({ highlightRowId: 1 });
    const highlighted = screen
      .getByText("Alpha")
      .closest('[role="row"]') as HTMLElement;
    expect(highlighted.className).toContain("outline-primary");
    // The other row is not highlighted.
    const other = screen
      .getByText("Beta")
      .closest('[role="row"]') as HTMLElement;
    expect(other.className).not.toContain("outline-primary");
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
