"use client";

import React from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import type { ReactNode } from "react";

interface SimpleDndProviderProps {
  children: ReactNode;
}

export function SimpleDndProvider({ children }: SimpleDndProviderProps) {
  return (
    <DndProvider backend={HTML5Backend}>
      {children}
    </DndProvider>
  );
}