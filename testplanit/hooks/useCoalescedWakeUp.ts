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
 *
 * `onFlush` may return a promise covering the refetch round it started. While
 * that promise is pending no new round begins: wake-ups keep accumulating and
 * a single follow-up round is scheduled once it settles. Without this, a
 * refetch slower than the window (an automated run's suite tree under a
 * streaming reporter) gets superseded by the next round before it lands — the
 * browser aborts it, the server and database still do the full work, and the
 * rounds pile up until the connection pool is exhausted.
 */
export function useCoalescedWakeUp(
  onFlush: (runIds: ReadonlySet<number | null>) => void | Promise<unknown>,
  delayMs: number = WAKE_UP_COALESCE_MS
): (event: TestRunWakeUp) => void {
  // Latest-ref so callers don't have to memoize onFlush — same reason the
  // stream hooks keep one for onWakeUp. delayMs gets the same treatment so
  // the post-settle reschedule reads the current value.
  const onFlushRef = useRef(onFlush);
  const delayMsRef = useRef(delayMs);
  useEffect(() => {
    onFlushRef.current = onFlush;
    delayMsRef.current = delayMs;
  }, [onFlush, delayMs]);

  const pendingRef = useRef<Set<number | null>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(
    () => () => {
      unmountedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const schedule = useCallback(function scheduleFlush() {
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const runIds = pendingRef.current;
      pendingRef.current = new Set();
      // Called synchronously so a void onFlush behaves exactly as before
      // (and a synchronous throw surfaces uncaught, as before).
      const result = onFlushRef.current(runIds) as Promise<unknown> | undefined;
      if (!result || typeof result.then !== "function") return;
      inFlightRef.current = true;
      const settle = () => {
        inFlightRef.current = false;
        if (unmountedRef.current) return;
        if (pendingRef.current.size > 0) scheduleFlush();
      };
      result.then(settle, (err) => {
        settle();
        console.warn("[useCoalescedWakeUp] flush round failed", err);
      });
    }, delayMsRef.current);
  }, []);

  return useCallback(
    (event: TestRunWakeUp) => {
      if (event.event === "sync") return;
      pendingRef.current.add(event.runId ?? null);
      if (timerRef.current || inFlightRef.current) return;
      schedule();
    },
    [schedule]
  );
}
