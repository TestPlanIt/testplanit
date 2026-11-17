"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { useDrop } from "react-dnd";
import { useDragModifier } from "~/hooks/useDragModifier";
import { useDragTargetKind } from "~/hooks/useDragTargetKind";
import { ItemTypes } from "~/types/dndTypes";
import { cn } from "~/utils";

export type CopyDropItems = Array<{ id: number | string }>;

/** The tree's copy routine: items, target folder id, target folder name. */
export type CopyDropHandler = (
  items: CopyDropItems,
  targetFolderId: number,
  targetFolderName: string
) => Promise<void> | void;

interface CaseDragItem {
  id?: number | string;
  draggedItems?: CopyDropItems;
}

interface CopyIntoFolderDropTargetProps {
  /** Receives the dragged cases when they are dropped here with the copy
   * modifier held. */
  onCopy: (items: CopyDropItems) => void;
  children: ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Lets the case list take a copy-modifier drop: the dragged cases are copied
 * into the folder the list is showing, under any sort. A plain drop is left to
 * the rows (reorder, in default order) — they refuse drops while the modifier
 * is held, so this outer target is the one that fires.
 */
export function CopyIntoFolderDropTarget({
  onCopy,
  children,
  className,
  testId,
}: CopyIntoFolderDropTargetProps) {
  const { isDraggingCase, canCopyIntoCurrentFolder } = useDragTargetKind();
  const { copyHeld } = useDragModifier(isDraggingCase);
  const ref = useRef<HTMLDivElement>(null);

  const [, drop] = useDrop<CaseDragItem, void, Record<string, never>>(
    () => ({
      accept: ItemTypes.TEST_CASE,
      canDrop: () => copyHeld && canCopyIntoCurrentFolder,
      drop: (item, monitor) => {
        // A row took it (reorder); nothing left to copy.
        if (monitor.didDrop()) return;
        const items: CopyDropItems =
          item.draggedItems && item.draggedItems.length > 0
            ? item.draggedItems
            : item.id != null
              ? [{ id: item.id }]
              : [];
        if (items.length === 0) return;
        onCopy(items);
      },
      collect: () => ({}),
    }),
    [copyHeld, canCopyIntoCurrentFolder, onCopy]
  );

  useEffect(() => {
    drop(ref);
  }, [drop]);

  return (
    <div ref={ref} className={cn("h-full", className)} data-testid={testId}>
      {children}
    </div>
  );
}

export default CopyIntoFolderDropTarget;
