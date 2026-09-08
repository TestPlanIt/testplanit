import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "~/test/test-utils";
import {
  useVirtualizedInfiniteList,
  type UseVirtualizedInfiniteListOptions,
} from "./useVirtualizedInfiniteList";

// jsdom has no IntersectionObserver. Provide a controllable stand-in that lets
// each test drive the sentinel's intersection state by hand. Disconnected
// instances drop out of the registry so `fireAll` only hits live observers.
let observers: MockIntersectionObserver[] = [];

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  elements = new Set<Element>();

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    this.callback = callback;
    this.options = options;
    observers.push(this);
  }
  observe(el: Element) {
    this.elements.add(el);
  }
  unobserve(el: Element) {
    this.elements.delete(el);
  }
  disconnect() {
    this.elements.clear();
    observers = observers.filter((o) => o !== this);
  }
  takeRecords() {
    return [];
  }
  fire(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

function fireAll(isIntersecting: boolean) {
  act(() => {
    observers.forEach((o) => o.fire(isIntersecting));
  });
}

type HarnessProps = Omit<UseVirtualizedInfiniteListOptions, "estimateSize"> & {
  estimateSize?: number;
};

function Harness(props: HarnessProps) {
  const { scrollRef, sentinelRef } = useVirtualizedInfiniteList({
    estimateSize: 40,
    ...props,
  });
  return (
    <div ref={scrollRef} data-testid="scroll" style={{ height: 400 }}>
      <div style={{ height: 1 }} />
      <div ref={sentinelRef} data-testid="sentinel" />
    </div>
  );
}

describe("useVirtualizedInfiniteList", () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers an intersection observer on the sentinel once bounded", () => {
    const onLoadMore = vi.fn();
    render(
      <Harness count={5} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );
    expect(observers.length).toBe(1);
    expect(observers[0].elements.size).toBe(1);
  });

  it("calls onLoadMore when the sentinel intersects and more is available", () => {
    const onLoadMore = vi.fn();
    render(
      <Harness count={5} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );
    expect(onLoadMore).not.toHaveBeenCalled();
    fireAll(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not call onLoadMore while a fetch is in flight", () => {
    const onLoadMore = vi.fn();
    render(
      <Harness count={5} hasMore isLoading={true} onLoadMore={onLoadMore} />
    );
    fireAll(true);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("does not call onLoadMore when there is nothing more to load", () => {
    const onLoadMore = vi.fn();
    render(
      <Harness
        count={5}
        hasMore={false}
        isLoading={false}
        onLoadMore={onLoadMore}
      />
    );
    fireAll(true);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("retries once a fetch settles while the sentinel stays in view", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Harness count={5} hasMore isLoading={true} onLoadMore={onLoadMore} />
    );
    // Sentinel is visible, but a fetch is in flight — no load yet.
    fireAll(true);
    expect(onLoadMore).not.toHaveBeenCalled();

    // Fetch settles; the sentinel is still in view, so the next page is pulled
    // without waiting for another scroll event.
    rerender(
      <Harness count={5} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("releases the load guard when a fetch is cancelled without new data (no deadlock)", () => {
    // Reproduces the project-issues infinite-scroll stall: a live-update
    // invalidation cancels an in-flight fetchNextPage, so `isLoading` goes
    // true→false but the loaded count never grows. The guard must still
    // release so the next scroll can retry — otherwise `pendingLoadRef` latches
    // at true and pagination deadlocks forever (the list stalls a page or two
    // in and no amount of scrolling loads more, even with `hasMore` still true).
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Harness count={5} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );

    // Scroll to the bottom → the first page is requested and the guard is held.
    fireAll(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // The fetch starts...
    rerender(
      <Harness count={5} hasMore isLoading={true} onLoadMore={onLoadMore} />
    );
    // ...then is cancelled mid-flight: `isLoading` falls back to false with the
    // SAME count (no page appended, so `loadGuardKey` never moves).
    rerender(
      <Harness count={5} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );

    // The sentinel is still in view, so the settled cycle must re-arm the load.
    // Before the falling-edge release this stayed latched at 1 forever.
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("holds the guard through an in-flight fetch (does not double-fire on the rising edge)", () => {
    // Guards the falling-edge release above from regressing into a rising-edge
    // reset, which would clear the guard while the request is still in flight
    // and let a second trigger cancel+restart it (the abort/re-fire loop the
    // guard exists to prevent).
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Harness count={5} hasMore isLoading={false} onLoadMore={onLoadMore} />
    );

    fireAll(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Fetch is in flight (isLoading true). A second sentinel intersection must
    // NOT kick off another load.
    rerender(
      <Harness count={5} hasMore isLoading={true} onLoadMore={onLoadMore} />
    );
    fireAll(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("wires the observer when the scroll container mounts after the hook", () => {
    // Mirrors UnifiedSearch, where the scroll container only renders once
    // results arrive — long after the hook itself first ran.
    function LateHarness({
      show,
      onLoadMore,
    }: {
      show: boolean;
      onLoadMore: () => void;
    }) {
      const { scrollRef, sentinelRef } = useVirtualizedInfiniteList({
        count: 5,
        hasMore: true,
        isLoading: false,
        onLoadMore,
        estimateSize: 40,
      });
      if (!show) return <div data-testid="placeholder" />;
      return (
        <div ref={scrollRef} data-testid="scroll" style={{ height: 400 }}>
          <div ref={sentinelRef} data-testid="sentinel" />
        </div>
      );
    }

    const onLoadMore = vi.fn();
    const { rerender } = render(
      <LateHarness show={false} onLoadMore={onLoadMore} />
    );
    // No scroll element yet → nothing observed.
    expect(observers.length).toBe(0);

    // Container mounts later → the observer must still get wired.
    rerender(<LateHarness show={true} onLoadMore={onLoadMore} />);
    expect(observers.length).toBe(1);

    fireAll(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("wires the observer in CSS-bound mode (boundToViewport=false) without a viewport height", () => {
    // The container is sized by its own layout (here a fixed height), so the
    // hook must not depend on the viewport-bottom maxHeight to wire the
    // sentinel — used by the reports panel.
    function CssBoundHarness({ onLoadMore }: { onLoadMore: () => void }) {
      const { scrollRef, sentinelRef, maxHeight } = useVirtualizedInfiniteList({
        count: 5,
        hasMore: true,
        isLoading: false,
        onLoadMore,
        estimateSize: 40,
        boundToViewport: false,
      });
      return (
        <div ref={scrollRef} data-testid="scroll" style={{ height: "100%" }}>
          <span data-testid="max-height">{String(maxHeight)}</span>
          <div ref={sentinelRef} data-testid="sentinel" />
        </div>
      );
    }

    const onLoadMore = vi.fn();
    render(<CssBoundHarness onLoadMore={onLoadMore} />);
    // No viewport-derived height is computed in this mode.
    expect(screen.getByTestId("max-height").textContent).toBe("null");
    // ...but the sentinel is still observed and can trigger a load.
    expect(observers.length).toBe(1);
    fireAll(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
