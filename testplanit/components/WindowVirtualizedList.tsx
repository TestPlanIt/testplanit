"use client";

import * as React from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

// useLayoutEffect warns under SSR; consumers are client components, but
// guard anyway so this is safe to import anywhere.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export interface WindowVirtualizedListProps<T> {
  items: T[];
  getKey: (item: T, index: number) => React.Key;
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateSize?: number;
  overscan?: number;
  "data-testid"?: string;
}

/**
 * Windowed list that scrolls with the page rather than in a container of its
 * own. Used by the milestone-grouped lists, which are one long tree of groups:
 * a bounded scroll region per group would leave the page scrolling differently
 * in different places depending on how many items each group happens to hold.
 * A window virtualizer keeps the single page scroll and still mounts only the
 * visible rows — which is what defers each row's own on-mount queries until it
 * comes into view.
 *
 * Rows must be flattened first; see buildGroupedListRows in
 * ~/utils/milestoneGroupCollapse.
 *
 * Positions come out in document space, so the list's distance from the top of
 * the document is subtracted back out. Everything above it can change height
 * (summary cards, filters, the bulk bar appearing), so that distance is
 * re-measured rather than read once.
 */
export function WindowVirtualizedList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 120,
  overscan = 8,
  "data-testid": testId,
}: WindowVirtualizedListProps<T>) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = React.useState(0);

  useIsomorphicLayoutEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const measure = () =>
      setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
  });

  return (
    <div
      ref={listRef}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
      data-testid={testId}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const item = items[virtualRow.index];
        if (item === undefined) return null;
        return (
          <div
            key={getKey(item, virtualRow.index)}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute start-0 top-0 flex w-full flex-col"
            style={{
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            {renderItem(item, virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
