import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "~/test/test-utils";
import { VirtualizedCardList } from "./VirtualizedCardList";

// The real hook drives TanStack Virtual + an IntersectionObserver, neither of
// which produces layout (or fires) under jsdom. Replace it with a pass-through
// that reports a configurable virtual window so we can assert the component
// renders exactly the windowed rows and forwards the right options. The hook
// has its own unit tests (hooks/useVirtualizedInfiniteList.test.tsx).
const hookMock = vi.hoisted(() => ({
  window: null as number[] | null, // indices to render; null = all `count`
  lastOpts: null as Record<string, unknown> | null,
}));

vi.mock("~/hooks/useVirtualizedInfiniteList", () => ({
  useVirtualizedInfiniteList: (opts: { count: number }) => {
    hookMock.lastOpts = opts as unknown as Record<string, unknown>;
    const indices =
      hookMock.window ?? Array.from({ length: opts.count }, (_, i) => i);
    return {
      scrollRef: () => {},
      sentinelRef: { current: null },
      virtualizer: {},
      virtualItems: indices.map((index) => ({
        key: index,
        index,
        start: index * 96,
        size: 96,
        end: (index + 1) * 96,
        lane: 0,
      })),
      totalSize: opts.count * 96,
      measureElement: () => {},
      maxHeight: null,
    };
  },
}));

interface Row {
  id: number;
  name: string;
}

const makeItems = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }));

const renderRow = (item: Row) => (
  <div data-testid={`row-${item.id}`}>{item.name}</div>
);

beforeEach(() => {
  hookMock.window = null;
  hookMock.lastOpts = null;
});

describe("VirtualizedCardList", () => {
  it("renders every row without a scroll container at or below the threshold", () => {
    render(
      <VirtualizedCardList
        items={makeItems(3)}
        getKey={(r) => r.id}
        renderItem={renderRow}
        virtualizeThreshold={30}
        data-testid="list"
      />
    );
    expect(screen.getByTestId("row-1")).toBeInTheDocument();
    expect(screen.getByTestId("row-3")).toBeInTheDocument();
    // Plain path: renders in the page's own scroll, no bounded container.
    expect(screen.getByTestId("list").className).not.toContain("overflow-auto");
  });

  it("moves into a bounded scroll container once above the threshold", () => {
    render(
      <VirtualizedCardList
        items={makeItems(3)}
        getKey={(r) => r.id}
        renderItem={renderRow}
        virtualizeThreshold={0}
        maxHeightClassName="max-h-[50vh]"
        data-testid="list"
      />
    );
    const container = screen.getByTestId("list");
    expect(container.className).toContain("overflow-auto");
    expect(container.className).toContain("max-h-[50vh]");
    expect(screen.getByTestId("row-1")).toBeInTheDocument();
    expect(screen.getByTestId("row-3")).toBeInTheDocument();
  });

  it("renders only the windowed rows when virtualized", () => {
    hookMock.window = [0, 1]; // hook reports only the first two of five
    render(
      <VirtualizedCardList
        items={makeItems(5)}
        getKey={(r) => r.id}
        renderItem={renderRow}
        virtualizeThreshold={0}
        data-testid="list"
      />
    );
    expect(screen.getByTestId("row-1")).toBeInTheDocument();
    expect(screen.getByTestId("row-2")).toBeInTheDocument();
    expect(screen.queryByTestId("row-3")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-5")).not.toBeInTheDocument();
  });

  it("forwards item count and windowing-only flags to the hook", () => {
    render(
      <VirtualizedCardList
        items={makeItems(4)}
        getKey={(r) => r.id}
        renderItem={renderRow}
        estimateSize={120}
      />
    );
    expect(hookMock.lastOpts).toMatchObject({
      count: 4,
      estimateSize: 120,
      hasMore: false,
      isLoading: false,
      boundToViewport: false,
    });
  });
});
