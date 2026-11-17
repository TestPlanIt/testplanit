"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";

interface DragTargetContextValue {
  isOverReorderZone: boolean;
  setIsOverReorderZone: (isOver: boolean) => void;
  /**
   * A test case is being dragged. Published through context rather than read
   * from useDragLayer so the drop zones can live outside a DnD provider — the
   * repository renders without one when it is embedded in another drag context.
   */
  isDraggingCase: boolean;
  setIsDraggingCase: (dragging: boolean) => void;
  /**
   * A folder is being dragged within the tree (react-arborist "NODE" item).
   * Lets the tree drop zone advertise itself during folder reorder/move the
   * same way it does for a case drag.
   */
  isDraggingFolder: boolean;
  setIsDraggingFolder: (dragging: boolean) => void;
  /**
   * Why a dragged case cannot be dropped back into the list right now, or null
   * when reordering is available. Rows stay draggable so the case can still be
   * dropped on a folder; the list drop zone reads this to say what to undo.
   */
  reorderBlockedReason: ReorderBlockedReason;
  setReorderBlockedReason: (reason: ReorderBlockedReason) => void;
  /**
   * The case list can take a copy-modifier drop that copies the dragged cases
   * into the folder it is showing. Published by the list (which knows the
   * folder, view and permissions) for the list drop zone and its drop target.
   */
  canCopyIntoCurrentFolder: boolean;
  setCanCopyIntoCurrentFolder: (can: boolean) => void;
}

export type ReorderBlockedReason = "sort" | "search" | null;

const DragTargetContext = createContext<DragTargetContextValue>({
  isOverReorderZone: false,
  setIsOverReorderZone: () => {},
  isDraggingCase: false,
  setIsDraggingCase: () => {},
  isDraggingFolder: false,
  setIsDraggingFolder: () => {},
  reorderBlockedReason: null,
  setReorderBlockedReason: () => {},
  canCopyIntoCurrentFolder: false,
  setCanCopyIntoCurrentFolder: () => {},
});

export function DragTargetProvider({ children }: { children: ReactNode }) {
  // Counter instead of boolean: when cursor moves between rows, effects fire in
  // tree order. A simple boolean loses the race when moving upward (earlier row
  // increments, later row decrements last → ends up false). With a counter and
  // functional setState, every increment/decrement is applied in sequence
  // regardless of effect order.
  const [hoverCount, setHoverCount] = useState(0);

  const [isDraggingCase, setIsDraggingCase] = useState(false);
  const [isDraggingFolder, setIsDraggingFolder] = useState(false);
  const [reorderBlockedReason, setReorderBlockedReason] =
    useState<ReorderBlockedReason>(null);
  const [canCopyIntoCurrentFolder, setCanCopyIntoCurrentFolder] =
    useState(false);

  const setIsOverReorderZone = useCallback((entering: boolean) => {
    setHoverCount((prev) => Math.max(0, prev + (entering ? 1 : -1)));
  }, []);

  return (
    <DragTargetContext.Provider
      value={{
        isOverReorderZone: hoverCount > 0,
        setIsOverReorderZone,
        isDraggingCase,
        setIsDraggingCase,
        isDraggingFolder,
        setIsDraggingFolder,
        reorderBlockedReason,
        setReorderBlockedReason,
        canCopyIntoCurrentFolder,
        setCanCopyIntoCurrentFolder,
      }}
    >
      {children}
    </DragTargetContext.Provider>
  );
}

export function useDragTargetKind() {
  return useContext(DragTargetContext);
}
