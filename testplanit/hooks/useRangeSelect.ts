import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * The ids from the anchor to the clicked one, in list order, or null when
 * either is not in the list.
 */
export function rowRange<T>(ids: T[], anchorId: T, clickedId: T): T[] | null {
  const from = ids.indexOf(anchorId);
  const to = ids.indexOf(clickedId);
  if (from === -1 || to === -1) return null;
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/**
 * Shift-click range selection for a list that keeps its selection as a set
 * of ids. `selectableIds` are the rows that may be selected, in the order
 * shown; rows left out of it (disabled ones) are skipped by a range.
 *
 * Call `anchor(id)` when a row is ticked, and `onClick(id, event)` from the
 * row's click: it returns true when it selected a range, in which case the
 * ordinary toggle must not run as well.
 */
export function useRangeSelect<T>(
  selectableIds: T[],
  setSelected: Dispatch<SetStateAction<Set<T>>>
) {
  const idsRef = useRef(selectableIds);
  useEffect(() => {
    idsRef.current = selectableIds;
  });
  const anchorRef = useRef<T | null>(null);

  const anchor = useCallback((id: T) => {
    anchorRef.current = id;
  }, []);

  const onClick = useCallback(
    (
      id: T,
      event: { shiftKey: boolean; preventDefault: () => void }
    ): boolean => {
      const from = anchorRef.current;
      if (!event.shiftKey || from === null || from === id) return false;
      const range = rowRange(idsRef.current, from, id);
      if (!range) return false;
      event.preventDefault();
      setSelected((current) => new Set([...current, ...range]));
      anchorRef.current = id;
      return true;
    },
    [setSelected]
  );

  return { anchor, onClick };
}
