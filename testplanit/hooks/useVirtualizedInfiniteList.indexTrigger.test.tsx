import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "~/test/test-utils";

// The virtualizer-index trigger fires off `virtualizer.getVirtualItems()`, which
// the REAL TanStack virtualizer renders empty under jsdom (no layout). So mock
// the virtualizer to return a controllable window of virtual items, letting us
// drive the "last rendered row" directly. IntersectionObserver is intentionally
// left undefined here so the sentinel-observer path stays inert and we test the
// index trigger in isolation.
let mockVirtualItems: Array<{
  index: number;
  key: number;
  start: number;
  size: number;
}> = [];

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => mockVirtualItems,
    getTotalSize: () => 10_000,
    measureElement: () => undefined,
    scrollToOffset: () => undefined,
  }),
}));

import { useVirtualizedInfiniteList } from "./useVirtualizedInfiniteList";

function row(index: number) {
  return { index, key: index, start: index * 40, size: 40 };
}

function Harness(props: {
  count: number;
  loadedCount?: number;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  loadMoreThreshold?: number;
}) {
  const { scrollRef, sentinelRef } = useVirtualizedInfiniteList({
    estimateSize: 40,
    boundToViewport: false,
    ...props,
  });
  return (
    <div ref={scrollRef} data-testid="scroll" style={{ height: 400 }}>
      <div ref={sentinelRef} data-testid="sentinel" />
    </div>
  );
}

describe("useVirtualizedInfiniteList — virtualizer-index trigger", () => {
  beforeEach(() => {
    mockVirtualItems = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fires when the last rendered row is within the threshold of the end", () => {
    mockVirtualItems = [row(95)];
    const onLoadMore = vi.fn();
    render(
      <Harness
        count={100}
        hasMore
        isLoading={false}
        onLoadMore={onLoadMore}
        loadMoreThreshold={10}
      />
    );
    // 95 >= 100 - 1 - 10 (=89) → load.
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when the last rendered row is far from the end", () => {
    mockVirtualItems = [row(20)];
    const onLoadMore = vi.fn();
    render(
      <Harness
        count={100}
        hasMore
        isLoading={false}
        onLoadMore={onLoadMore}
        loadMoreThreshold={10}
      />
    );
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does NOT fire while a fetch is in flight", () => {
    mockVirtualItems = [row(95)];
    const onLoadMore = vi.fn();
    render(
      <Harness count={100} hasMore isLoading={true} onLoadMore={onLoadMore} />
    );
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does NOT fire when there is nothing more to load", () => {
    mockVirtualItems = [row(95)];
    const onLoadMore = vi.fn();
    render(
      <Harness
        count={100}
        hasMore={false}
        isLoading={false}
        onLoadMore={onLoadMore}
      />
    );
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("fires at most once per count — a re-render at the same count does not double-fire", () => {
    mockVirtualItems = [row(95)];
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Harness count={100} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Scroll shifts the window (new array) but count hasn't advanced — the
    // pending guard must block a second call (this is the abort-loop guard).
    mockVirtualItems = [row(96)];
    rerender(
      <Harness count={100} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("fires again once count advances (a page landed) and we're still near the end", () => {
    mockVirtualItems = [row(95)];
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Harness count={100} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Page landed: count grew and the last rendered row is near the new end.
    mockVirtualItems = [row(145)];
    rerender(
      <Harness count={150} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("advances pagination when a page lands but the visible count stays flat (rolled-up parent)", () => {
    // Models a giant collapsed group: the whole page rolls into one parent, so
    // the rendered `count` never grows — only the raw `loadedCount` does.
    mockVirtualItems = [row(0)];
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Harness
        count={1}
        loadedCount={50}
        hasMore
        isLoading={false}
        onLoadMore={onLoadMore}
        loadMoreThreshold={10}
      />
    );
    // count=1: 0 >= 1 - 1 - 10 → fired once, guard set.
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Next page landed: visible count unchanged (still one collapsed parent),
    // but loadedCount grew — the guard must release so the next page is pulled.
    mockVirtualItems = [row(0)];
    rerender(
      <Harness
        count={1}
        loadedCount={100}
        hasMore
        isLoading={false}
        onLoadMore={onLoadMore}
        loadMoreThreshold={10}
      />
    );
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("does NOT advance when neither the visible count nor the loaded count grows", () => {
    // No page landed (loadedCount flat) → the guard must hold, so the two
    // triggers can't double-fire into the fetch abort loop.
    mockVirtualItems = [row(0)];
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Harness
        count={1}
        loadedCount={50}
        hasMore
        isLoading={false}
        onLoadMore={onLoadMore}
        loadMoreThreshold={10}
      />
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    mockVirtualItems = [row(0)];
    rerender(
      <Harness
        count={1}
        loadedCount={50}
        hasMore
        isLoading={false}
        onLoadMore={onLoadMore}
        loadMoreThreshold={10}
      />
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("stops firing once the loaded window pulls back from the end", () => {
    mockVirtualItems = [row(95)];
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Harness count={100} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Page landed (count 150) but the user hasn't scrolled — the last rendered
    // row is still ~95, now far from the end → no further load.
    mockVirtualItems = [row(95)];
    rerender(
      <Harness count={150} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
