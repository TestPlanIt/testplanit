"use client";

import { useEffect } from "react";
import { useDragLayer } from "react-dnd";
import { useDragTargetKind } from "~/hooks/useDragTargetKind";
import { ItemTypes } from "~/types/dndTypes";

/**
 * Publishes what's being dragged (a test case, or a folder in the tree) onto the
 * drag context.
 *
 * Renders nothing. It exists so the drop zones can subscribe without calling
 * useDragLayer themselves, which would throw wherever the repository renders
 * outside a DnD provider. react-arborist drags folders as react-dnd items of
 * type "NODE" in this same context, so a folder drag is detectable here too.
 */
export function DragStateBridge() {
  const { isDraggingCase, isDraggingFolder } = useDragLayer((monitor) => {
    const dragging = monitor.isDragging();
    const type = monitor.getItemType();
    return {
      isDraggingCase: dragging && type === ItemTypes.TEST_CASE,
      isDraggingFolder: dragging && type === "NODE",
    };
  });
  const { setIsDraggingCase, setIsDraggingFolder } = useDragTargetKind();

  useEffect(() => {
    setIsDraggingCase(isDraggingCase);
  }, [isDraggingCase, setIsDraggingCase]);

  useEffect(() => {
    setIsDraggingFolder(isDraggingFolder);
  }, [isDraggingFolder, setIsDraggingFolder]);

  return null;
}
