"use client";

import { useSortable } from "@dnd-kit/sortable";
import type { HTMLAttributes, ReactNode } from "react";

export interface SortableDatasetRowProps {
  id: number | string;
  children: (props: {
    attributes: HTMLAttributes<unknown>;
    listeners: Record<string, unknown> | undefined;
    setNodeRef: (node: HTMLElement | null) => void;
    setActivatorNodeRef: (node: HTMLElement | null) => void;
    transform: ReturnType<typeof useSortable>["transform"];
    transition: ReturnType<typeof useSortable>["transition"];
    isDragging: boolean;
    /** "top" or "bottom" when this row is the drop target, else null. */
    dropIndicator: "top" | "bottom" | null;
  }) => ReactNode;
}

/**
 * Render-prop wrapper for a dataset grid row. Mirrors the canonical
 * `SortableStep.tsx` pattern: the consumer attaches `attributes` +
 * `listeners` to a drag-handle <div> ONLY (column 1, w-6), not the
 * <tr> itself — see Phase 2 RESEARCH Pitfall 3. This keeps cell clicks
 * from triggering drag-start.
 */
export function SortableDatasetRow({ id, children }: SortableDatasetRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    over,
    active,
    index,
  } = useSortable({ id });

  // Compute the insertion line:
  //  - the row that the cursor is currently OVER decides where the line goes
  //  - if active is moving DOWN (activeIndex < overIndex), draw below the over row
  //  - if active is moving UP (activeIndex > overIndex), draw above the over row
  const overData = over?.data?.current as
    | { sortable?: { index?: number } }
    | undefined;
  const activeData = active?.data?.current as
    | { sortable?: { index?: number } }
    | undefined;
  let dropIndicator: "top" | "bottom" | null = null;
  if (over && active && over.id === id && active.id !== id) {
    const overIndex = overData?.sortable?.index ?? index;
    const activeIndex = activeData?.sortable?.index ?? -1;
    dropIndicator = activeIndex < overIndex ? "bottom" : "top";
  }

  return (
    <>
      {children({
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
        dropIndicator,
      })}
    </>
  );
}
