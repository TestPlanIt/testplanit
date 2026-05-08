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
}

const DragTargetContext = createContext<DragTargetContextValue>({
  isOverReorderZone: false,
  setIsOverReorderZone: () => {},
});

export function DragTargetProvider({ children }: { children: ReactNode }) {
  // Counter instead of boolean: when cursor moves between rows, effects fire in
  // tree order. A simple boolean loses the race when moving upward (earlier row
  // increments, later row decrements last → ends up false). With a counter and
  // functional setState, every increment/decrement is applied in sequence
  // regardless of effect order.
  const [hoverCount, setHoverCount] = useState(0);

  const setIsOverReorderZone = useCallback((entering: boolean) => {
    setHoverCount((prev) => Math.max(0, prev + (entering ? 1 : -1)));
  }, []);

  return (
    <DragTargetContext.Provider
      value={{ isOverReorderZone: hoverCount > 0, setIsOverReorderZone }}
    >
      {children}
    </DragTargetContext.Provider>
  );
}

export function useDragTargetKind() {
  return useContext(DragTargetContext);
}
