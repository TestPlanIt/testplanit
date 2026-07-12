"use client";

import * as React from "react";
import { useVirtualizedInfiniteList } from "~/hooks/useVirtualizedInfiniteList";
import { cn } from "~/utils";

const NOOP = () => {};

interface VirtualizedCardListProps<T> {
  /** The full, already-loaded item array. */
  items: T[];
  /** Render one item. Receives the item and its index in `items`. */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Stable React key for an item. */
  getKey: (item: T, index: number) => React.Key;
  /** Estimated row height (px), used before dynamic measurement settles. */
  estimateSize?: number;
  /** Rows rendered beyond the visible window on each side. */
  overscan?: number;
  /**
   * At or below this many items the list renders every row in the page's
   * natural scroll — no bounded scroll container — so small lists keep their
   * existing layout and virtualization only engages where it earns the nested
   * scroll region. Set to 0 to always virtualize.
   */
  virtualizeThreshold?: number;
  /**
   * Tailwind max-height applied to the scroll container once virtualized. The
   * container only scrolls when the rows exceed this height.
   */
  maxHeightClassName?: string;
  /** Extra classes for the outer container (both paths). */
  className?: string;
  "data-testid"?: string;
}

/**
 * Windowed vertical list of card rows. Wraps the shared
 * `useVirtualizedInfiniteList` in its windowing-only mode (no infinite fetch:
 * `hasMore` is always false) so a long, already-loaded array renders only the
 * visible window instead of mounting every row at once.
 *
 * Gating: lists at or below `virtualizeThreshold` render in full inside the
 * page's own scroll, unchanged. Above it, rows move into a `max-h` scroll
 * container and only the visible window (plus overscan) mounts — which also
 * defers each row's own on-mount work (per-row queries, etc.) until it scrolls
 * into view.
 *
 * Each virtual row is wrapped in a `flex flex-col` element so the row's own
 * vertical margin is included in its measured height (flex containers don't
 * collapse child margins), keeping dynamic measurement and row spacing aligned.
 */
export function VirtualizedCardList<T>({
  items,
  renderItem,
  getKey,
  estimateSize = 96,
  overscan = 6,
  virtualizeThreshold = 30,
  maxHeightClassName = "max-h-[70vh]",
  className,
  "data-testid": testId,
}: VirtualizedCardListProps<T>) {
  const shouldVirtualize = items.length > virtualizeThreshold;

  // Hooks must run unconditionally; the windowing machinery is inert on the
  // plain path (count still drives it, but we simply don't read the output).
  const { scrollRef, virtualItems, totalSize, measureElement } =
    useVirtualizedInfiniteList({
      count: items.length,
      estimateSize,
      overscan,
      hasMore: false,
      isLoading: false,
      onLoadMore: NOOP,
      boundToViewport: false,
    });

  if (!shouldVirtualize) {
    return (
      <div className={cn("space-y-2", className)} data-testid={testId}>
        {items.map((item, index) => (
          <React.Fragment key={getKey(item, index)}>
            {renderItem(item, index)}
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={cn("relative overflow-auto", maxHeightClassName, className)}
      data-testid={testId}
    >
      <div className="relative w-full" style={{ height: totalSize }}>
        {virtualItems.map((vItem) => {
          const item = items[vItem.index];
          if (item === undefined) return null;
          return (
            <div
              key={getKey(item, vItem.index)}
              data-index={vItem.index}
              ref={measureElement}
              className="absolute start-0 top-0 flex w-full flex-col"
              style={{ transform: `translateY(${vItem.start}px)` }}
            >
              {renderItem(item, vItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
