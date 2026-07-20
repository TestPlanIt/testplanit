"use client";

import { useEffect } from "react";
import { useDragLayer } from "react-dnd";
import { useDragTargetKind } from "~/hooks/useDragTargetKind";
import { ItemTypes } from "~/types/dndTypes";

/**
 * Publishes "a test case is being dragged" onto the drag context.
 *
 * Renders nothing. It exists so the drop zones can subscribe without calling
 * useDragLayer themselves, which would throw wherever the repository renders
 * outside a DnD provider.
 */
export function DragStateBridge() {
  const isDraggingCase = useDragLayer(
    (monitor) =>
      monitor.isDragging() && monitor.getItemType() === ItemTypes.TEST_CASE
  );
  const { setIsDraggingCase } = useDragTargetKind();

  useEffect(() => {
    setIsDraggingCase(isDraggingCase);
  }, [isDraggingCase, setIsDraggingCase]);

  return null;
}
