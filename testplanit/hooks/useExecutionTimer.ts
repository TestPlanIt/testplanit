"use client";

/**
 * Execution timers: how long a tester has spent on each case they can record
 * a result for.
 *
 * One timer per execution target (a run case, or one iteration of it), kept
 * in a module-level store so the case sheet and the Add Result dialog show the
 * same clock. A timer runs while something on the page is showing its case and
 * the tester has not paused it. It keeps running while the tab is hidden:
 * testers read a step, work in the application under test, and come back.
 *
 * The time is derived from a start timestamp, not from counted ticks, so a
 * throttled background tab loses nothing. Timers are kept in `sessionStorage`
 * so they survive a reload or leaving a case and coming back, within one tab.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MAX_DURATION } from "~/app/constants";

const STORAGE_KEY = "testplanit:execution-timers";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface TimerEntry {
  /** Time banked before the current running stretch, in milliseconds. */
  accumulatedMs: number;
  /** When the current running stretch began (epoch ms), or null when stopped. */
  runningSince: number | null;
  /** The tester stopped the clock; showing the case again must not restart it. */
  userPaused: boolean;
}

interface StoredEntry {
  ms: number;
  userPaused: boolean;
  savedAt: number;
}

const entries = new Map<string, TimerEntry>();
/** How many mounted components are showing each timer's case. */
const viewers = new Map<string, number>();
const listeners = new Set<() => void>();
let loaded = false;
let flushOnHideAttached = false;

export function executionTimerKey(
  testRunId: number,
  testRunCaseId: number,
  iterationId?: number | null
): string {
  const base = `run:${testRunId}:case:${testRunCaseId}`;
  return iterationId ? `${base}:iter:${iterationId}` : base;
}

function elapsedMs(entry: TimerEntry, now: number): number {
  return (
    entry.accumulatedMs +
    (entry.runningSince === null ? 0 : Math.max(0, now - entry.runningSince))
  );
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Write every timer with the time it shows right now. */
function persist(): void {
  const store = storage();
  if (!store) return;
  const now = Date.now();
  const stored: Record<string, StoredEntry> = {};
  for (const [key, entry] of entries) {
    stored[key] = {
      ms: elapsedMs(entry, now),
      userPaused: entry.userPaused,
      savedAt: now,
    };
  }
  try {
    if (Object.keys(stored).length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage full or blocked: the timers still work for this page view.
  }
}

function load(): void {
  if (loaded) return;
  loaded = true;
  const store = storage();
  if (!store) return;

  if (!flushOnHideAttached) {
    flushOnHideAttached = true;
    // A running timer is only written when it changes state, so bank its
    // current time before the page goes away.
    window.addEventListener("pagehide", persist);
  }

  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Record<string, StoredEntry>;
    const now = Date.now();
    for (const [key, value] of Object.entries(stored)) {
      if (
        !value ||
        typeof value.ms !== "number" ||
        typeof value.savedAt !== "number" ||
        now - value.savedAt > MAX_AGE_MS
      ) {
        continue;
      }
      entries.set(key, {
        accumulatedMs: Math.max(0, value.ms),
        runningSince: null,
        userPaused: value.userPaused === true,
      });
    }
  } catch {
    // Unreadable storage is the same as none.
  }
}

function commit(key: string, entry: TimerEntry | null): void {
  if (entry) entries.set(key, entry);
  else entries.delete(key);
  persist();
  for (const listener of listeners) listener();
}

/** A component began showing this timer's case: run unless the tester paused. */
export function enterExecutionTimer(key: string): void {
  load();
  viewers.set(key, (viewers.get(key) ?? 0) + 1);
  const entry = entries.get(key);
  if (!entry) {
    commit(key, {
      accumulatedMs: 0,
      runningSince: Date.now(),
      userPaused: false,
    });
  } else if (!entry.userPaused && entry.runningSince === null) {
    commit(key, { ...entry, runningSince: Date.now() });
  }
}

/** A component stopped showing the case: stop once nothing shows it. */
export function leaveExecutionTimer(key: string): void {
  const remaining = (viewers.get(key) ?? 1) - 1;
  if (remaining > 0) {
    viewers.set(key, remaining);
    return;
  }
  viewers.delete(key);
  const entry = entries.get(key);
  if (!entry) return;
  const banked = elapsedMs(entry, Date.now());
  // A glance of under a second is not worth carrying around.
  if (banked < 1000 && !entry.userPaused) {
    commit(key, null);
  } else if (entry.runningSince !== null) {
    commit(key, { ...entry, accumulatedMs: banked, runningSince: null });
  }
}

export function pauseExecutionTimer(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  commit(key, {
    accumulatedMs: elapsedMs(entry, Date.now()),
    runningSince: null,
    userPaused: true,
  });
}

export function resumeExecutionTimer(key: string): void {
  const entry = entries.get(key);
  commit(key, {
    accumulatedMs: entry ? elapsedMs(entry, Date.now()) : 0,
    runningSince: Date.now(),
    userPaused: false,
  });
}

/** The tester typed a time: show it and stop, so it is not counted past. */
export function setExecutionTimer(key: string, seconds: number): void {
  commit(key, {
    accumulatedMs: Math.max(0, Math.floor(seconds)) * 1000,
    runningSince: null,
    userPaused: true,
  });
}

function toSeconds(entry: TimerEntry | undefined, now: number): number {
  if (!entry) return 0;
  return Math.min(MAX_DURATION, Math.floor(elapsedMs(entry, now) / 1000));
}

/** Whole seconds on the timer right now. */
export function readExecutionTimer(key: string): number {
  load();
  return toSeconds(entries.get(key), Date.now());
}

/** The value to send as a result's `elapsed`: seconds, or null for no time. */
export function executionTimerElapsed(key: string | null): number | null {
  if (!key) return null;
  return readExecutionTimer(key) || null;
}

/**
 * A result was saved with this timer's time. Clear it; if the case is still
 * on screen the clock starts again from zero for the next attempt.
 */
export function consumeExecutionTimer(key: string | null): void {
  if (!key) return;
  commit(
    key,
    (viewers.get(key) ?? 0) > 0
      ? { accumulatedMs: 0, runningSince: Date.now(), userPaused: false }
      : null
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface ExecutionTimer {
  /** False when there is nothing to time (no key given). */
  tracking: boolean;
  seconds: number;
  running: boolean;
  pause: () => void;
  resume: () => void;
  set: (seconds: number) => void;
}

/**
 * Time the case behind `key` for as long as the calling component is mounted.
 * Pass null where a result cannot be entered; nothing is timed.
 */
export function useExecutionTimer(key: string | null): ExecutionTimer {
  useEffect(() => {
    if (!key) return;
    enterExecutionTimer(key);
    return () => leaveExecutionTimer(key);
  }, [key]);

  const entry = useSyncExternalStore(
    subscribe,
    () => (key ? entries.get(key) : undefined),
    () => undefined
  );
  const running = entry?.runningSince != null;

  // The store only changes on start and stop; this redraws the clock between,
  // on the timer's own second boundaries so every clock showing it agrees.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!entry || entry.runningSince === null) return;
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const untilNextSecond = 1000 - (elapsedMs(entry, Date.now()) % 1000);
      timeout = setTimeout(() => {
        setTick((tick) => tick + 1);
        schedule();
      }, untilNextSecond + 5);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, [entry]);

  const pause = useCallback(() => {
    if (key) pauseExecutionTimer(key);
  }, [key]);
  const resume = useCallback(() => {
    if (key) resumeExecutionTimer(key);
  }, [key]);
  const set = useCallback(
    (seconds: number) => {
      if (key) setExecutionTimer(key, seconds);
    },
    [key]
  );

  return {
    tracking: key !== null,
    seconds: toSeconds(entry, Date.now()),
    running,
    pause,
    resume,
    set,
  };
}

/** Test seam: forget every timer and reread storage on next use. */
export function resetExecutionTimersForTest(): void {
  entries.clear();
  viewers.clear();
  loaded = false;
}
