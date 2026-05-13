"use client";

import { useCallback, useState } from "react";

/**
 * Local selection state for the iteration sidebar's bulk-skip toolbar
 * (Surface A.6). Mirrors the Phase 2 `DatasetTab` `selectedRowIds` shape
 * (`useState<Set<number>>`).
 */
export function useSelectedIterationIds(): {
  selectedIds: Set<number>;
  toggle: (id: number) => void;
  clear: () => void;
  selectAll: (ids: number[]) => void;
  isSelected: (id: number) => boolean;
} {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggle = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const selectAll = useCallback((ids: number[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const isSelected = useCallback(
    (id: number) => selectedIds.has(id),
    [selectedIds]
  );

  return { selectedIds, toggle, clear, selectAll, isSelected };
}

export default useSelectedIterationIds;
