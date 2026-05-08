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
  const [isOverReorderZone, setIsOverReorderZoneState] = useState(false);

  const setIsOverReorderZone = useCallback((isOver: boolean) => {
    setIsOverReorderZoneState(isOver);
  }, []);

  return (
    <DragTargetContext.Provider
      value={{ isOverReorderZone, setIsOverReorderZone }}
    >
      {children}
    </DragTargetContext.Provider>
  );
}

export function useDragTargetKind() {
  return useContext(DragTargetContext);
}
