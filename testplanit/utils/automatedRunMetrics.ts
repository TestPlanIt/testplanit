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
  let retriedCaseCount = 0;
  const flakyCaseIds = new Set<number | string>();

  for (const [caseId, attempts] of byCase) {
    if (attempts.length < 2) continue;
    retriedCaseCount++;
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
    retriedCaseCount,
    flakyCaseCount: flakyCaseIds.size,
    flakyCaseIds,
  };
}
