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
}

const DragTargetContext = createContext<DragTargetContextValue>({
  isOverReorderZone: false,
  setIsOverReorderZone: () => {},
  isDraggingCase: false,
  setIsDraggingCase: () => {},
});

export function DragTargetProvider({ children }: { children: ReactNode }) {
  // Counter instead of boolean: when cursor moves between rows, effects fire in
  // tree order. A simple boolean loses the race when moving upward (earlier row
  // increments, later row decrements last → ends up false). With a counter and
  // functional setState, every increment/decrement is applied in sequence
  // regardless of effect order.
  const [hoverCount, setHoverCount] = useState(0);

  const [isDraggingCase, setIsDraggingCase] = useState(false);

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
      }}
    >
      {children}
    </DragTargetContext.Provider>
  );
}

export function useDragTargetKind() {
  return useContext(DragTargetContext);
}
