"use client";
/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer() returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it (same as components/matrix/MatrixGrid.tsx). */

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Shared wiring for a virtualized, infinite-scrolling list.
 *
 * Combines three concerns that a paginated surface needs to drop the
 * page-seam scroll reset:
 *
 *   1. A row virtualizer (TanStack Virtual) so an accumulated hit/row array
 *      of arbitrary length renders only the visible window.
 *   2. A bounded scroll-container height computed from the live bounding rect
 *      to the viewport bottom — without it the virtualizer treats the parent
 *      as infinitely tall and renders every row (see MatrixGrid for the same
 *      reasoning).
 *   3. An IntersectionObserver sentinel near the bottom that fetches the next
 *      page as the user nears it and the result set is appended in place.
 *
 * Attach `scrollRef` to the scroll container, render the virtual items inside
 * a spacer sized to `totalSize`, and place a zero-height element with
 * `sentinelRef` after the spacer. Wire each row's `ref` to `measureElement`
 * and give it a `data-index` so variable-height rows measure themselves.
 *
 * Designed to be consumed by more than one surface (UnifiedSearch results and
 * the reports table) so both converge on the same scroll model.
 */

export interface UseVirtualizedInfiniteListOptions {
  /** Number of items currently loaded (the accumulated array length). */
  count: number;
  /** Estimated row height in px, used before dynamic measurement settles. */
  estimateSize?: number;
  /** Rows rendered beyond the visible window on each side. */
  overscan?: number;
  /** Whether another page can be fetched. */
  hasMore: boolean;
  /** Whether a fetch is currently in flight. */
  isLoading: boolean;
  /** Called when the sentinel nears the viewport and another page is available. */
  onLoadMore: () => void;
  /** Distance (px) below the viewport at which to prefetch the next page. */
  loadMoreMargin?: number;
  /** Space (px) to leave below the list when filling the viewport. */
  bottomMargin?: number;
  /**
   * When true (default), the scroll container is sized to fill from its top
   * edge to the viewport bottom. Set false when the container is bounded by
   * its own layout instead (e.g. a fixed-height panel) — the consumer sizes it
   * via CSS (`h-full`) and the returned `maxHeight` stays null. In that mode
   * the load-more sentinel wires as soon as the scroll element mounts, and
   * container resizes are picked up by the virtualizer's own ResizeObserver.
   */
  boundToViewport?: boolean;
  /** When this value changes, the list scrolls to the top and re-measures. */
  resetKey?: unknown;
}

// useLayoutEffect warns when run during SSR; consumers are client components,
// but guard anyway so the hook is safe to import anywhere.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function useVirtualizedInfiniteList({
  count,
  estimateSize = 140,
  overscan = 6,
  hasMore,
  isLoading,
  onLoadMore,
  loadMoreMargin = 300,
  bottomMargin = 16,
  boundToViewport = true,
  resetKey,
}: UseVirtualizedInfiniteListOptions) {
  // A callback ref (rather than a plain useRef) so the effects re-run when the
  // scroll container actually mounts. The container is often rendered *after*
  // this hook (e.g. only once search results arrive), so a one-shot mount
  // effect would measure a null element and leave `maxHeight` null forever —
  // unbounding the list and disabling the load-more sentinel.
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollElRef.current = node;
    setScrollEl(node);
  }, []);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!boundToViewport || !scrollEl) return;
    const compute = () => {
      const top = scrollEl.getBoundingClientRect().top;
      setMaxHeight(Math.max(200, window.innerHeight - top - bottomMargin));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [boundToViewport, scrollEl, bottomMargin]);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count,
    getScrollElement: () => scrollElRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  // Latest values for the observer callback without re-subscribing each
  // render. `isIntersecting` is tracked so a settled fetch can re-attempt a
  // load while the sentinel is still in view (result set shorter than the
  // viewport).
  const stateRef = useRef({
    hasMore,
    isLoading,
    onLoadMore,
    isIntersecting: false,
  });
  stateRef.current.hasMore = hasMore;
  stateRef.current.isLoading = isLoading;
  stateRef.current.onLoadMore = onLoadMore;

  const maybeLoadMore = useCallback(() => {
    const s = stateRef.current;
    if (s.isIntersecting && s.hasMore && !s.isLoading) s.onLoadMore();
  }, []);

  // Only wire the sentinel once the container is mounted and bounded, so an
  // unbounded first paint can't fire a burst of page loads before the height
  // settles. In viewport-bound mode that means waiting for `maxHeight`; in
  // CSS-bound mode the container is already sized, so wire as soon as the
  // scroll element mounts. Re-runs when the scroll element mounts (`scrollEl`).
  useEffect(() => {
    if (boundToViewport && maxHeight == null) return;
    const root = scrollElRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        stateRef.current.isIntersecting = entry.isIntersecting;
        if (entry.isIntersecting) maybeLoadMore();
      },
      { root, rootMargin: `0px 0px ${loadMoreMargin}px 0px`, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollEl, maxHeight, boundToViewport, loadMoreMargin, maybeLoadMore]);

  // After a page settles (or hasMore flips), pull again if the sentinel is
  // still visible — fills the viewport without waiting for a scroll event.
  useEffect(() => {
    maybeLoadMore();
  }, [count, hasMore, isLoading, maybeLoadMore]);

  // Reset scroll position and drop cached measurements when the query/scope
  // changes so the new result set starts from the top.
  useEffect(() => {
    const el = scrollElRef.current;
    if (el) el.scrollTop = 0;
    virtualizer.scrollToOffset(0);
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return {
    scrollRef,
    sentinelRef,
    virtualizer,
    virtualItems: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
    measureElement: virtualizer.measureElement,
    maxHeight,
  };
}
