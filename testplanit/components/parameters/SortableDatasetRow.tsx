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
  } = useSortable({ id });

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
      })}
    </>
  );
}
