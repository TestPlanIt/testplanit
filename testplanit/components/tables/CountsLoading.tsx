"use client";

import { createContext, useContext, type ReactNode } from "react";

const CountsLoadingContext = createContext(false);

/**
 * Tells the count cells below it whether their counts are still loading.
 *
 * The flag goes through context, not through the column definitions: a table
 * rebuilds every cell when its column definitions change, which closes any
 * menu or popover open in a row.
 */
export const CountsLoadingProvider = CountsLoadingContext.Provider;

export function CountsLoading({
  children,
}: {
  children: (isLoading: boolean) => ReactNode;
}) {
  return <>{children(useContext(CountsLoadingContext))}</>;
}
