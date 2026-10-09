/**
 * Pure metric math for alerts (#651).
 *
 * Every function here takes already-loaded history and returns a verdict;
 * none of them touch the database, so the evaluation service can be tested
 * with mocked reads and the math with plain arrays. Results are ordered
 * newest first everywhere, which matches the `ORDER BY executedAt DESC`
 * the loaders use.
 */

export type BaselineType = "MEAN" | "MEDIAN";
export type DeviationDirection = "ABOVE" | "BELOW" | "EITHER";

/** A past result reduced to what the metrics need. */
export interface ResultSample {
  /** Seconds; null when the result carries no duration. */
  elapsed: number | null;
  isSuccess: boolean;
  isFailure: boolean;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function baselineOf(
  values: readonly number[],
  type: BaselineType
): number {
  return type === "MEAN" ? mean(values) : median(values);
}

export interface DurationDeviationVerdict {
  fired: boolean;
  /** Signed percentage change of the new duration against the baseline. */
  deviationPercent: number;
  baseline: number;
  sampleCount: number;
  reason?: "no_elapsed" | "insufficient_samples" | "zero_baseline";
}

/**
 * Metric 1: the new result's duration deviates from the case's baseline by
 * more than `thresholdPercent`, in the chosen direction. `previous` is the
 * case's earlier results, newest first; only those with a duration count,
 * and only the first `window` of them build the baseline.
 */
export function evaluateDurationDeviation(params: {
  current: number | null;
  previous: readonly ResultSample[];
  window: number;
  minSamples: number;
  baselineType: BaselineType;
  thresholdPercent: number;
  direction: DeviationDirection;
}): DurationDeviationVerdict {
  const notFired = (
    reason: DurationDeviationVerdict["reason"],
    sampleCount = 0,
    baseline = 0
  ): DurationDeviationVerdict => ({
    fired: false,
    deviationPercent: 0,
    baseline,
    sampleCount,
    reason,
  });

  if (params.current == null || params.current < 0) {
    return notFired("no_elapsed");
  }
  const durations = params.previous
    .map((r) => r.elapsed)
    .filter((e): e is number => e != null && e >= 0)
    .slice(0, Math.max(1, params.window));
  if (durations.length < Math.max(1, params.minSamples)) {
    return notFired("insufficient_samples", durations.length);
  }
  const baseline = baselineOf(durations, params.baselineType);
  if (baseline <= 0) {
    return notFired("zero_baseline", durations.length, baseline);
  }
  const deviationPercent = ((params.current - baseline) / baseline) * 100;
  const magnitude = Math.abs(deviationPercent);
  const inDirection =
    params.direction === "EITHER" ||
    (params.direction === "ABOVE" && deviationPercent > 0) ||
    (params.direction === "BELOW" && deviationPercent < 0);
  return {
    fired: inDirection && magnitude > params.thresholdPercent,
    deviationPercent,
    baseline,
    sampleCount: durations.length,
  };
}

/** Only results that carry a verdict take part in pass/fail sequences. */
export function withVerdict(samples: readonly ResultSample[]): ResultSample[] {
  return samples.filter((s) => s.isSuccess || s.isFailure);
}

export interface RegressionVerdict {
  fired: boolean;
  passedBefore: number;
}

/**
 * Metric 2: the new result failed and every one of the previous `window`
 * verdict results passed. Needs at least `minSamples` of them.
 */
export function evaluateRegression(params: {
  current: ResultSample;
  previous: readonly ResultSample[];
  window: number;
  minSamples: number;
}): RegressionVerdict {
  if (!params.current.isFailure) return { fired: false, passedBefore: 0 };
  const history = withVerdict(params.previous).slice(
    0,
    Math.max(1, params.window)
  );
  const passedBefore = history.filter((s) => s.isSuccess).length;
  const allPassed = history.length > 0 && passedBefore === history.length;
  return {
    fired: allPassed && history.length >= Math.max(1, params.minSamples),
    passedBefore,
  };
}

export interface ConsecutiveFailuresVerdict {
  fired: boolean;
  streak: number;
}

/**
 * Metric 4: counting the new result, the case has failed `count` times in a
 * row. Fires exactly when the streak reaches the count, so a case that keeps
 * failing does not re-fire on every result (the cooldown covers the rest).
 */
export function evaluateConsecutiveFailures(params: {
  current: ResultSample;
  previous: readonly ResultSample[];
  count: number;
}): ConsecutiveFailuresVerdict {
  if (!params.current.isFailure) return { fired: false, streak: 0 };
  let streak = 1;
  for (const sample of withVerdict(params.previous)) {
    if (!sample.isFailure) break;
    streak += 1;
  }
  const count = Math.max(1, params.count);
  return { fired: streak >= count, streak };
}

export interface FlakinessVerdict {
  fired: boolean;
  flips: number;
  sampleCount: number;
}

/**
 * Metric 5: within the last `window` verdict results (the new one included),
 * the outcome flipped between pass and fail at least `flipThreshold` times.
 * Mirrors the Flaky Tests report inputs.
 */
export function evaluateFlakiness(params: {
  current: ResultSample;
  previous: readonly ResultSample[];
  window: number;
  minSamples: number;
  flipThreshold: number;
}): FlakinessVerdict {
  const sequence = withVerdict([params.current, ...params.previous]).slice(
    0,
    Math.max(2, params.window)
  );
  let flips = 0;
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i].isSuccess !== sequence[i - 1].isSuccess) flips += 1;
  }
  const enough = sequence.length >= Math.max(2, params.minSamples);
  return {
    fired: enough && flips >= Math.max(1, params.flipThreshold),
    flips,
    sampleCount: sequence.length,
  };
}

export interface RunCounts {
  passed: number;
  failed: number;
}

export interface PassRateVerdict {
  fired: boolean;
  passRate: number;
  sampleCount: number;
}

/**
 * Metric 7: pass rate (passed over results with a verdict) is under the
 * threshold once at least `minSamples` verdicts exist.
 */
export function evaluatePassRate(params: {
  counts: RunCounts;
  thresholdPercent: number;
  minSamples: number;
}): PassRateVerdict {
  const sampleCount = params.counts.passed + params.counts.failed;
  if (sampleCount === 0 || sampleCount < Math.max(1, params.minSamples)) {
    return { fired: false, passRate: 0, sampleCount };
  }
  const passRate = (params.counts.passed / sampleCount) * 100;
  return { fired: passRate < params.thresholdPercent, passRate, sampleCount };
}

export interface FailureCountVerdict {
  fired: boolean;
  failed: number;
}

/** Metric 8: more than `count` failed results in the run. */
export function evaluateFailureCount(params: {
  counts: RunCounts;
  count: number;
}): FailureCountVerdict {
  return {
    fired: params.counts.failed > Math.max(0, params.count),
    failed: params.counts.failed,
  };
}

export interface MilestoneBehindVerdict {
  fired: boolean;
  completionPercent: number;
  daysRemaining: number;
}

/**
 * Metric 13: completion is under `thresholdPercent` with `daysRemaining` or
 * fewer days left before the due date (and the milestone is not yet due).
 */
export function evaluateMilestoneBehind(params: {
  completed: number;
  total: number;
  dueAt: Date;
  now: Date;
  thresholdPercent: number;
  daysRemaining: number;
}): MilestoneBehindVerdict {
  const completionPercent =
    params.total > 0 ? (params.completed / params.total) * 100 : 0;
  const daysLeft = daysBetween(params.now, params.dueAt);
  const fired =
    params.total > 0 &&
    daysLeft >= 0 &&
    daysLeft <= Math.max(0, params.daysRemaining) &&
    completionPercent < params.thresholdPercent;
  return { fired, completionPercent, daysRemaining: daysLeft };
}

export interface MilestoneOverdueVerdict {
  fired: boolean;
  daysOverdue: number;
}

/** Metric 14: the due date has passed. */
export function evaluateMilestoneOverdue(params: {
  dueAt: Date;
  now: Date;
}): MilestoneOverdueVerdict {
  const daysLeft = daysBetween(params.now, params.dueAt);
  return { fired: daysLeft < 0, daysOverdue: daysLeft < 0 ? -daysLeft : 0 };
}

/**
 * Whole days from `from` to `to`: positive when `to` is ahead. Future dates
 * round up (three and a half days left counts as four, so a "three days
 * remaining" rule waits), past dates round down (half a day late is late).
 */
export function daysBetween(from: Date, to: Date): number {
  const diff = to.getTime() - from.getTime();
  const day = 1000 * 60 * 60 * 24;
  return diff >= 0 ? Math.ceil(diff / day) : Math.floor(diff / day);
}

/** Whether a cooldown window has elapsed since the last firing for a subject. */
export function cooldownElapsed(
  lastFiredAt: Date | null | undefined,
  cooldownMinutes: number,
  now: Date
): boolean {
  if (!lastFiredAt) return true;
  if (cooldownMinutes <= 0) return true;
  return now.getTime() - lastFiredAt.getTime() >= cooldownMinutes * 60 * 1000;
}
