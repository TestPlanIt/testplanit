"use client";

import { useCallback } from "react";
import { usePersistedFilter } from "./usePersistedFilter";

const parseCollapsed = (stored: string | null): boolean => stored === "true";

/**
 * Collapsed/expanded state for a case detail panel, remembered per panel in
 * localStorage so it carries across cases and reloads.
 *
 * `hydrated` is false until the stored value has been read; panels that skip
 * their queries while collapsed should also wait for it, or an expanded-by-
 * default first render fires the query a collapsed panel meant to skip.
 */
export function usePanelCollapsed(panelId: string) {
  const [collapsed, setCollapsed, hydrated] = usePersistedFilter(
    `case-panel-collapsed:${panelId}`,
    false,
    parseCollapsed
  );

  const toggle = useCallback(
    () => setCollapsed(!collapsed),
    [collapsed, setCollapsed]
  );

  return { collapsed, toggle, hydrated };
}
