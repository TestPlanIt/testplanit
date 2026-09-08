"use client";

import { useCallback, useEffect, useRef } from "react";
import type { TestRunWakeUp } from "./useTestRunLiveStream";

/** Long enough to swallow a reporter's result burst, short enough that a
 *  human clicking a status still sees the tile update immediately. */
export const WAKE_UP_COALESCE_MS = 250;

/**
 * Collapse a burst of wake-ups into a single invalidation round.
 *
 * Result rows publish one wake-up each — `sideEffectsPlugin` loops over the
 * written rows and calls `emitTestRunResultAdded` per row — so a bulk write
 * (a reporter streaming a suite, a `createMany` import) delivers N wake-ups
 * back to back. Every one that reaches a consumer costs a full round of
 * refetches, and rounds arriving faster than they complete leave requests
 * stranded (the client aborts, the server finishes work nobody reads).
 *
 * The window is a fixed delay from the FIRST wake-up, not a debounce that
 * restarts on each one: a continuously-streaming run would keep resetting a
 * restarting timer and never refetch at all. This way a burst costs one
 * round, and a sustained stream settles at one round per window.
 *
 * `onFlush` receives every run id seen during the window so consumers can
 * invalidate per run. A wake-up carrying no run id lands as `null` in the
 * set — consumers that narrow by run should treat that as "unknown, refetch
 * broadly". The `sync` checkpoint is dropped here rather than by each
 * caller: it fires on every EventSource reconnect and signals nothing.
 */
export function useCoalescedWakeUp(
  onFlush: (runIds: ReadonlySet<number | null>) => void,
  delayMs: number = WAKE_UP_COALESCE_MS
): (event: TestRunWakeUp) => void {
  // Latest-ref so callers don't have to memoize onFlush — same reason the
  // stream hooks keep one for onWakeUp.
  const onFlushRef = useRef(onFlush);
  useEffect(() => {
    onFlushRef.current = onFlush;
  }, [onFlush]);

  const pendingRef = useRef<Set<number | null>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return useCallback(
    (event: TestRunWakeUp) => {
      if (event.event === "sync") return;
      pendingRef.current.add(event.runId ?? null);
      if (timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const runIds = pendingRef.current;
        pendingRef.current = new Set();
        onFlushRef.current(runIds);
      }, delayMs);
    },
    [delayMs]
  );
}
