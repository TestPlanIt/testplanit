"use client";

import React from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import type { ReactNode } from "react";

interface SimpleDndProviderProps {
  children: ReactNode;
}

// Simple wrapper around DndProvider that always uses HTML5Backend.
// The "Cannot have two HTML5 backends" error typically occurs when
// multiple DndProvider instances with HTML5Backend exist in the same
// document. To avoid this:
// 1. Use SimpleDndProvider at a high level in your component tree
// 2. Don't nest SimpleDndProvider instances - the outer one provides
//    context for all descendants
// 3. For portaled content (like modals), the DnD context is lost,
//    so you may need a SimpleDndProvider there too - but ensure only
//    one is active at a time by conditionally rendering.
export function SimpleDndProvider({ children }: SimpleDndProviderProps) {
  return (
    <DndProvider backend={HTML5Backend}>
      {children}
    </DndProvider>
  );
}