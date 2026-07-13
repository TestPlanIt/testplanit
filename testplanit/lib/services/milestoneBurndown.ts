/**
 * Burndown series builder for a milestone/sprint (fast-follow READY, D4).
 *
 * A burndown plots remaining test work over the milestone's time window:
 * X = calendar day (window start → target end), Y = executable items still
 * lacking a first result. The "actual" line is `total − cumulative executed
 * by that day`; the "ideal" guideline (drawn client-side) runs from the
 * remaining-at-start down to zero at the target end.
 *
 * This module is the pure, deterministic core — it takes an already-bucketed
 * map of first-execution counts and the window bounds, so it is exhaustively
 * unit-testable without a database or a live clock. The route
 * (`app/api/milestones/[milestoneId]/burndown`) supplies the SQL-derived map
 * and `now`.
 *
 * Scope note: manual test-run cases, automated (JUnit/TestNG) cases, and
 * sessions all contribute. Manual cases and sessions carry a per-item execution
 * timestamp; automated runs don't, so the route dates their whole batch by the
 * run's `createdAt` (import time). This module doesn't care which is which — it
 * just consumes the merged per-day counts.
 */

export interface MilestoneBurndownPoint {
  /** ISO calendar day (yyyy-mm-dd, UTC) this snapshot represents. */
  date: string;
  /** Executable items still without a first result at the end of this day. */
  remaining: number;
}

export interface MilestoneBurndownData {
  milestoneId: number;
  /** Total executable items in scope (manual cases + sessions). Y-axis top. */
  total: number;
  /** ISO day the window opens (startedAt ?? createdAt), or null when there is
   *  nothing to plot (no scope). */
  start: string | null;
  /** ISO day of the target end (completedAt), or null when the milestone has
   *  no target date — the ideal guideline is drawn only when this is set. */
  end: string | null;
  /** True when a real target end exists, so the client draws the ideal line. */
  hasTarget: boolean;
  /** Remaining-work snapshot per day across the window. */
  actual: MilestoneBurndownPoint[];
}

/** UTC calendar-day key (yyyy-mm-dd) for a Date. */
export function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Cap on the number of daily points so a pathological window (e.g. a stray
 * multi-year target date) can't produce an unbounded series. A sprint is days
 * to weeks and a release rarely more than a few months, so this only ever
 * clamps outliers.
 */
const DEFAULT_MAX_DAYS = 400;

export function buildBurndownSeries(input: {
  milestoneId: number;
  /** Total executable items in scope (manual cases + sessions). */
  total: number;
  /** Window start (startedAt ?? createdAt); null short-circuits to empty. */
  start: Date | null;
  /** Target end (completedAt); null means no ideal line and walk-to-now. */
  end: Date | null;
  /** First-execution counts keyed by UTC day (yyyy-mm-dd). */
  executionsByDay: Map<string, number>;
  /** Current time — supplied so the builder stays deterministic in tests. */
  now: Date;
  maxDays?: number;
}): MilestoneBurndownData {
  const { milestoneId, total, start, end, executionsByDay, now } = input;
  const maxDays = input.maxDays ?? DEFAULT_MAX_DAYS;

  // Nothing to plot without scope or a start anchor.
  if (total <= 0 || !start) {
    return {
      milestoneId,
      total: Math.max(0, total),
      start: null,
      end: null,
      hasTarget: false,
      actual: [],
    };
  }

  const startKey = toDayKey(start);
  const todayKey = toDayKey(now);
  const rawEndKey = end != null ? toDayKey(end) : null;
  // A target only anchors an ideal guideline when it falls AFTER the window
  // start. A `completedAt` on or before the start — e.g. a synced milestone
  // whose `startedAt` is unset, so the start fell back to a later date — is not
  // a usable burndown target; treat it as "no target" rather than drawing an
  // ideal line that runs backwards in time.
  const hasTarget = rawEndKey != null && rawEndKey > startKey;

  // Where the walk stops: the target day when set; otherwise the later of today
  // and the last execution, so an in-progress milestone still shows progress to
  // date instead of stopping at its last recorded result.
  const execDays = [...executionsByDay.keys()].sort();
  const lastExecKey = execDays.length
    ? execDays[execDays.length - 1]
    : startKey;
  let endKey = hasTarget
    ? (rawEndKey as string)
    : todayKey > lastExecKey
      ? todayKey
      : lastExecKey;
  if (endKey < startKey) endKey = startKey;

  // Executions before the window opens are already "done" on day 0 — seed the
  // running total with them so the actual line starts below `total` when work
  // began early.
  let cumulative = 0;
  for (const [day, count] of executionsByDay) {
    if (day < startKey) cumulative += count;
  }

  const actual: MilestoneBurndownPoint[] = [];
  const endDate = new Date(`${endKey}T00:00:00.000Z`);
  let dayCursor = new Date(`${startKey}T00:00:00.000Z`);
  let guard = 0;
  while (dayCursor.getTime() <= endDate.getTime() && guard < maxDays) {
    const key = toDayKey(dayCursor);
    cumulative += executionsByDay.get(key) ?? 0;
    actual.push({ date: key, remaining: Math.max(0, total - cumulative) });
    dayCursor = new Date(dayCursor.getTime() + 86_400_000);
    guard += 1;
  }

  return {
    milestoneId,
    total,
    start: startKey,
    end: hasTarget ? (rawEndKey as string) : null,
    hasTarget,
    actual,
  };
}
