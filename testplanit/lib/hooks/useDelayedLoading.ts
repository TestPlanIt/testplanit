import { useEffect, useRef, useState } from "react";

/**
 * Returns a deferred loading flag that only becomes `true` if `isLoading` has
 * been `true` for longer than `delayMs`. Prevents spinner flicker on fast
 * fetches while still surfacing a loading indicator for slow ones.
 */
export function useDelayedLoading(
  isLoading: boolean,
  delayMs: number = 500
): boolean {
  const [showLoading, setShowLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) {
      timerRef.current = setTimeout(() => setShowLoading(true), delayMs);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShowLoading(false);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isLoading, delayMs]);

  return showLoading;
}
