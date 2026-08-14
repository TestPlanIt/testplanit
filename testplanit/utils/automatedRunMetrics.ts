/**
 * Execution metrics for automated (JUnit) test runs, in the spirit of the
 * Allure report summary: the wall-clock window the run occupied, the linear
 * sum of every test's own duration, and how the two relate (parallelism).
 *
 * All duration inputs/outputs are SECONDS (JUnit `time` semantics).
 */

export interface AutomatedResultMetricInput {
  /** Per-test duration in seconds, when the reporter sent one. */
  time?: number | null;
  /** JUnit result type: PASSED | FAILURE | ERROR | SKIPPED. */
  resultType?: string | null;
}

export interface AutomatedRunMetrics {
  totalCount: number;
  /** Results that reported a positive duration. */
  timedCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  /** Passed results as a percentage of all results (0-100), null when empty. */
  passRate: number | null;
  /** Linear sum of individual test durations. */
  totalTime: number;
  /** Wall-clock seconds between the first and last recorded result. */
  wallClockSeconds: number | null;
  /**
   * totalTime / wallClockSeconds — the average number of tests executing at
   * any moment. Null when the wall-clock window is missing or sub-second, or
   * when the ratio exceeds the number of timed tests (more concurrency than
   * tests is impossible — it means every result was stamped by one bulk
   * import, so the window is the upload, not the execution).
   */
  parallelism: number | null;
  avgTime: number | null;
  medianTime: number | null;
  maxTime: number | null;
}

export function wallClockSecondsBetween(
  first: Date | string | null | undefined,
  last: Date | string | null | undefined
): number | null {
  if (!first || !last) return null;
  const start = new Date(first).getTime();
  const end = new Date(last).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / 1000;
}

function median(sortedAsc: number[]): number | null {
  if (sortedAsc.length === 0) return null;
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 === 1
    ? sortedAsc[mid]
    : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

export function computeAutomatedRunMetrics({
  results,
  firstResultAt,
  lastResultAt,
}: {
  results: AutomatedResultMetricInput[];
  firstResultAt?: Date | string | null;
  lastResultAt?: Date | string | null;
}): AutomatedRunMetrics {
  const totalCount = results.length;

  let passedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const times: number[] = [];
  for (const result of results) {
    switch (result.resultType) {
      case "FAILURE":
      case "ERROR":
        failedCount++;
        break;
      case "SKIPPED":
        skippedCount++;
        break;
      default:
        passedCount++;
    }
    if (typeof result.time === "number" && result.time > 0) {
      times.push(result.time);
    }
  }

  times.sort((a, b) => a - b);
  const timedCount = times.length;
  const totalTime = times.reduce((sum, t) => sum + t, 0);
  const wallClockSeconds = wallClockSecondsBetween(firstResultAt, lastResultAt);

  let parallelism: number | null = null;
  if (
    wallClockSeconds !== null &&
    wallClockSeconds >= 1 &&
    totalTime > 0 &&
    totalTime / wallClockSeconds <= timedCount
  ) {
    parallelism = totalTime / wallClockSeconds;
  }

  return {
    totalCount,
    timedCount,
    passedCount,
    failedCount,
    skippedCount,
    passRate: totalCount > 0 ? (passedCount / totalCount) * 100 : null,
    totalTime,
    wallClockSeconds,
    parallelism,
    avgTime: timedCount > 0 ? totalTime / timedCount : null,
    medianTime: median(times),
    maxTime: timedCount > 0 ? times[times.length - 1] : null,
  };
}

/**
 * The `count` longest-running results, longest first. Results without a
 * positive duration are excluded.
 */
export function topSlowestResults<T extends { time?: number | null }>(
  results: T[],
  count: number
): T[] {
  return results
    .filter((r) => typeof r.time === "number" && r.time > 0)
    .sort((a, b) => (b.time as number) - (a.time as number))
    .slice(0, count);
}

export interface AutomatedAttemptInput {
  /** Repository case id the result row belongs to. */
  id?: number | string;
  /** JUnitTestResult row id — tie-breaker for attempt ordering. */
  resultId?: number;
  resultType?: string | null;
  executedAt?: Date | string | null;
  createdAt?: Date | string | null;
  /**
   * Parameterized cases route each iteration's result to the same repository
   * case, so their multiple rows are iterations, not retries — excluded.
   */
  hasParameters?: boolean;
}

export interface RetryMetrics {
  /** Attempts beyond each case's first (Allure's "retries" number). */
  retriesCount: number;
  retriedCaseCount: number;
  /** Cases that failed at least once and passed on their final attempt. */
  flakyCaseCount: number;
  flakyCaseIds: Set<number | string>;
  /** Cases with more than one attempt row, flaky or not. */
  retriedCaseIds: Set<number | string>;
}

function attemptTimeMs(attempt: AutomatedAttemptInput): number {
  const at = attempt.executedAt ?? attempt.createdAt;
  if (!at) return 0;
  const ms = new Date(at).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Within-run retry/flaky detection, Allure-style: a case is flaky when an
 * earlier attempt failed and the final attempt passed. Depends on the
 * reporter posting every attempt as its own result row (TestPlanIt's
 * Playwright/WDIO reporters do; final-attempt-only JUnit XML cannot be
 * detected).
 */
export function computeRetryMetrics(
  results: AutomatedAttemptInput[]
): RetryMetrics {
  const byCase = new Map<number | string, AutomatedAttemptInput[]>();
  for (const result of results) {
    if (result.id === undefined || result.id === null) continue;
    if (result.hasParameters) continue;
    const attempts = byCase.get(result.id);
    if (attempts) {
      attempts.push(result);
    } else {
      byCase.set(result.id, [result]);
    }
  }

  let retriesCount = 0;
  const flakyCaseIds = new Set<number | string>();
  const retriedCaseIds = new Set<number | string>();

  for (const [caseId, attempts] of byCase) {
    if (attempts.length < 2) continue;
    retriedCaseIds.add(caseId);
    retriesCount += attempts.length - 1;

    attempts.sort(
      (a, b) =>
        attemptTimeMs(a) - attemptTimeMs(b) ||
        (a.resultId ?? 0) - (b.resultId ?? 0)
    );
    const final = attempts[attempts.length - 1];
    const finalPassed =
      final.resultType !== "FAILURE" &&
      final.resultType !== "ERROR" &&
      final.resultType !== "SKIPPED";
    const earlierFailed = attempts
      .slice(0, -1)
      .some((a) => a.resultType === "FAILURE" || a.resultType === "ERROR");
    if (finalPassed && earlierFailed) {
      flakyCaseIds.add(caseId);
    }
  }

  return {
    retriesCount,
    retriedCaseCount: retriedCaseIds.size,
    flakyCaseCount: flakyCaseIds.size,
    flakyCaseIds,
    retriedCaseIds,
  };
}

export interface ExecutionWindowInput {
  time?: number | null;
  executedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export interface ExecutionWindow {
  startMs: number;
  endMs: number;
}

/**
 * Reconstruct each result's execution window as [end − duration, end].
 * Reporters post a result when it finishes, so `executedAt` (falling back to
 * the row's import time) approximates the end. Results without a positive
 * duration or a parseable timestamp get no window.
 */
export function buildExecutionWindows<T extends ExecutionWindowInput>(
  results: T[]
): Array<{ result: T; startMs: number; endMs: number }> {
  const windows: Array<{ result: T; startMs: number; endMs: number }> = [];
  for (const result of results) {
    if (typeof result.time !== "number" || !(result.time > 0)) continue;
    const at = result.executedAt ?? result.createdAt;
    if (!at) continue;
    const endMs = new Date(at).getTime();
    if (Number.isNaN(endMs)) continue;
    windows.push({ result, startMs: endMs - result.time * 1000, endMs });
  }
  return windows;
}

/**
 * A bulk XML import stamps every result with the one upload instant, so the
 * reconstructed windows all share an endpoint and look massively concurrent
 * when they never were. Real reporter-streamed runs spread their finish
 * times across the run.
 */
export function hasRealExecutionWindows(windows: ExecutionWindow[]): boolean {
  if (windows.length < 2) return false;
  let minEnd = Infinity;
  let maxEnd = -Infinity;
  for (const w of windows) {
    if (w.endMs < minEnd) minEnd = w.endMs;
    if (w.endMs > maxEnd) maxEnd = w.endMs;
  }
  return maxEnd - minEnd >= 1000;
}

export interface ConcurrencyMetrics {
  /** Most tests executing at any one moment — the effective worker count. */
  peak: number;
  /** Time-weighted average concurrency across the run's span. */
  average: number;
}

/**
 * Sweep-line concurrency over the reconstructed execution windows: how many
 * tests were running at once. Null when the run can't support the
 * reconstruction (fewer than two timed results, a sub-second span, or every
 * window ending at practically the same instant — see
 * hasRealExecutionWindows).
 */
export function computeConcurrencyMetrics(
  results: ExecutionWindowInput[]
): ConcurrencyMetrics | null {
  const windows = buildExecutionWindows(results);
  if (!hasRealExecutionWindows(windows)) return null;

  let minStart = Infinity;
  let maxEnd = -Infinity;
  let totalMs = 0;
  for (const w of windows) {
    if (w.startMs < minStart) minStart = w.startMs;
    if (w.endMs > maxEnd) maxEnd = w.endMs;
    totalMs += w.endMs - w.startMs;
  }
  const spanMs = maxEnd - minStart;
  if (spanMs < 1000) return null;

  // Ends sort before starts at equal timestamps so back-to-back tests in one
  // worker don't read as overlapping.
  const events: Array<[number, number]> = [];
  for (const w of windows) {
    events.push([w.startMs, 1]);
    events.push([w.endMs, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  let current = 0;
  let peak = 0;
  for (const [, delta] of events) {
    current += delta;
    if (current > peak) peak = current;
  }

  return { peak, average: totalMs / spanMs };
}

/**
 * First-fit lane packing for the execution timeline: each window goes to the
 * first lane free at its start (1ms grace for float rounding). Returns the
 * lane index per window, in input order; lanes are created in first-use
 * order, so lane count == peak concurrency of the packed windows.
 */
export function assignExecutionLanes(windows: ExecutionWindow[]): number[] {
  const order = windows
    .map((_, index) => index)
    .sort(
      (a, b) =>
        windows[a].startMs - windows[b].startMs ||
        windows[a].endMs - windows[b].endMs
    );
  const laneEnds: number[] = [];
  const lanes = new Array<number>(windows.length).fill(0);
  for (const index of order) {
    const w = windows[index];
    let lane = laneEnds.findIndex((end) => end <= w.startMs + 1);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(w.endMs);
    } else {
      laneEnds[lane] = w.endMs;
    }
    lanes[index] = lane;
  }
  return lanes;
}
