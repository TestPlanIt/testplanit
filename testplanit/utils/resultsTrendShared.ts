import type { DateGrouping } from "~/lib/reports/dateGrouping";

/**
 * The Test Case Results Trend report's data contract and the arithmetic the
 * chart, the stat tiles and the CSV derive from it. Pure: no server or React
 * imports, so the server handler, the client chart and the tests all read the
 * same rules.
 *
 * The server returns one row per project per period in the window, plus one
 * combined row per period (`project: null`) summing every project in the
 * run. Periods follow the run's date grouping (day, Monday-start week, month,
 * quarter or year) in the run's timezone and are keyed by their first day
 * (`YYYY-MM-DD`); the period containing "now" is the partial one.
 */

export const TREND_ATTEMPT_MODES = ["all", "latest"] as const;
export type TrendAttemptMode = (typeof TREND_ATTEMPT_MODES)[number];

/** Which runs' results the report counts. */
export const TREND_RUN_SOURCES = ["automated", "manual", "both"] as const;
export type TrendRunSource = (typeof TREND_RUN_SOURCES)[number];
export const DEFAULT_TREND_RUN_SOURCE: TrendRunSource = "both";

export const DEFAULT_TREND_GROUPING: DateGrouping = "weekly";

/** How many periods a run without a date range shows, ending with today's. */
export const DEFAULT_TREND_PERIOD_COUNT: Record<DateGrouping, number> = {
  daily: 30,
  weekly: 12,
  monthly: 12,
  quarterly: 8,
  annually: 5,
};

/** A date range cannot spell out more periods than this. */
export const MAX_TREND_PERIODS = 400;

/** Pass/fail change (in percentage points) below which the trend is "steady". */
export const TREND_STEADY_BAND_POINTS = 1;

/** How many complete periods the headline stats average as the baseline. */
export const HEADLINE_BASELINE_PERIODS = 4;

export const RESULT_BUCKETS = ["passed", "failed", "skipped", "other"] as const;
export type ResultBucket = (typeof RESULT_BUCKETS)[number];

export interface TrendPeriod {
  /** The period's first day in the run's timezone, `YYYY-MM-DD`. */
  periodStart: string;
  /** The period containing now: it has not ended, so its figures still move. */
  partial: boolean;
}

export interface TrendProject {
  id: number;
  name: string;
  iconUrl?: string | null;
}

export interface TrendSettings {
  dateGrouping: DateGrouping;
  /** Automated runs, manual runs, or every run. */
  runSource: TrendRunSource;
  /** Skipped results stay in the rate denominator. */
  countSkipped: boolean;
  /** Runs sitting in their project's abandoned-run state are counted. */
  includeAborted: boolean;
  /** Every attempt counts, or only the latest attempt per case per run. */
  attemptMode: TrendAttemptMode;
  /** Chart options: which rates the charts and headline figures show. */
  showPassRate: boolean;
  showFailRate: boolean;
  /** Chart option: draw the stacked result totals. Off by default. */
  showCounts: boolean;
  /** The IANA timezone periods were cut in. */
  timezone: string;
}

export interface ResultsTrendRow {
  /** `null` is the combined row: every project in the run summed. */
  project: TrendProject | null;
  periodStart: string;
  partial: boolean;
  runs: number;
  results: number;
  passed: number;
  failed: number;
  skipped: number;
  other: number;
  /** Percent, or null when the period has nothing to rate. */
  passRate: number | null;
  failRate: number | null;
}

/** What the chart needs beside the rows; echoed by the server. */
export interface ResultsTrendMeta {
  periods: TrendPeriod[];
  projects: TrendProject[];
  settings: TrendSettings;
}

export function isTrendAttemptMode(value: unknown): value is TrendAttemptMode {
  return (
    typeof value === "string" &&
    (TREND_ATTEMPT_MODES as readonly string[]).includes(value)
  );
}

export function isTrendRunSource(value: unknown): value is TrendRunSource {
  return (
    typeof value === "string" &&
    (TREND_RUN_SOURCES as readonly string[]).includes(value)
  );
}

/** The rate denominator: every result, or every result that was not skipped. */
export function rateDenominator(
  counts: Pick<ResultsTrendRow, "results" | "skipped">,
  countSkipped: boolean
): number {
  return countSkipped ? counts.results : counts.results - counts.skipped;
}

/** `part / whole` as a percent rounded to two decimals; null for an empty whole. */
export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 10000) / 100;
}

/** Fill the two rates from the counts under the given denominator rule. */
export function withRates(
  counts: Omit<ResultsTrendRow, "passRate" | "failRate">,
  countSkipped: boolean
): ResultsTrendRow {
  const denominator = rateDenominator(counts, countSkipped);
  return {
    ...counts,
    passRate: percentOf(counts.passed, denominator),
    failRate: percentOf(counts.failed, denominator),
  };
}

/** Rows for one project (or the combined rows), oldest period first. */
export function rowsForProject(
  rows: ResultsTrendRow[],
  projectId: number | null
): ResultsTrendRow[] {
  return rows
    .filter((row) => (row.project?.id ?? null) === projectId)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

export interface LinearFit {
  slope: number;
  intercept: number;
  /** The fitted line's value at the first and last point. */
  start: number;
  end: number;
  /** `end - start`: the change the line describes across the points. */
  change: number;
  points: number;
}

/**
 * Ordinary least squares over `values` at x = 0, 1, 2, …; null with fewer
 * than two points. A flat series fits a zero slope.
 */
export function linearFit(values: number[]): LinearFit | null {
  const n = values.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  values.forEach((y, x) => {
    sxx += (x - meanX) * (x - meanX);
    sxy += (x - meanX) * (y - meanY);
  });
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const start = intercept;
  const end = intercept + slope * (n - 1);
  return { slope, intercept, start, end, change: end - start, points: n };
}

export type TrendVerdict = "better" | "worse" | "steady";

/** Read a fail-rate change in points as a verdict: down is better. */
export function trendVerdict(changePoints: number): TrendVerdict {
  if (changePoints < -TREND_STEADY_BAND_POINTS) return "better";
  if (changePoints > TREND_STEADY_BAND_POINTS) return "worse";
  return "steady";
}

export interface FailRateTrend {
  verdict: TrendVerdict;
  /** The trend line's fail rate at the first and last complete period, in percent. */
  startRate: number;
  endRate: number;
  /** `endRate - startRate`, in percentage points. */
  changePoints: number;
  /** Complete periods with results that the line was fitted to. */
  periodsUsed: number;
}

/**
 * The failure-rate trend for one project's rows (or the combined rows): a
 * line fitted to the fail rate over the complete periods that have a rate.
 * The partial period and empty periods are left out. Null until two such
 * periods exist.
 */
/**
 * The fitted line for either rate over the complete periods that have it:
 * what the charts draw as the dashed trend. Null until two such periods.
 */
export function rateFit(
  rows: ResultsTrendRow[],
  key: "passRate" | "failRate"
): LinearFit | null {
  const series = rows
    .filter((row) => !row.partial && row[key] !== null)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .map((row) => row[key] as number);
  return linearFit(series);
}

export function failRateTrend(rows: ResultsTrendRow[]): FailRateTrend | null {
  const series = rows
    .filter((row) => !row.partial && row.failRate !== null)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .map((row) => row.failRate as number);
  const fit = linearFit(series);
  if (!fit) return null;
  return {
    verdict: trendVerdict(fit.change),
    startRate: fit.start,
    endRate: fit.end,
    changePoints: fit.change,
    periodsUsed: fit.points,
  };
}

export interface HeadlineStat {
  /** The last complete period's figure; null when it has no rate. */
  current: number | null;
  /** The mean over the complete periods before it; null when none has a figure. */
  baseline: number | null;
  /** How many periods the baseline averages. */
  baselinePeriods: number;
  /** `current - baseline` for rates (points); `(current - baseline) / baseline` × 100 for volumes. */
  delta: number | null;
}

export interface HeadlineStats {
  /** The last complete period the stats describe, or null when there is none. */
  period: string | null;
  passRate: HeadlineStat;
  failRate: HeadlineStat;
  results: HeadlineStat;
  runs: HeadlineStat;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function rateStat(current: number | null, priorValues: number[]): HeadlineStat {
  const baseline = mean(priorValues);
  return {
    current,
    baseline,
    baselinePeriods: priorValues.length,
    delta: current !== null && baseline !== null ? current - baseline : null,
  };
}

function volumeStat(current: number, priorValues: number[]): HeadlineStat {
  const baseline = mean(priorValues);
  return {
    current,
    baseline,
    baselinePeriods: priorValues.length,
    delta:
      baseline !== null && baseline > 0
        ? ((current - baseline) / baseline) * 100
        : null,
  };
}

/**
 * The last complete period's pass rate, fail rate, result count and run
 * count, each against the average of the complete periods before it (up to
 * HEADLINE_BASELINE_PERIODS of them). Periods with no results contribute
 * nothing to a rate's baseline but count as zero volume.
 */
export function headlineStats(rows: ResultsTrendRow[]): HeadlineStats {
  const complete = rows
    .filter((row) => !row.partial)
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const empty = (): HeadlineStat => ({
    current: null,
    baseline: null,
    baselinePeriods: 0,
    delta: null,
  });
  if (complete.length === 0) {
    return {
      period: null,
      passRate: empty(),
      failRate: empty(),
      results: empty(),
      runs: empty(),
    };
  }
  const last = complete[complete.length - 1];
  const prior = complete.slice(
    Math.max(0, complete.length - 1 - HEADLINE_BASELINE_PERIODS),
    complete.length - 1
  );
  const rated = prior.filter((row) => row.passRate !== null);
  return {
    period: last.periodStart,
    passRate: rateStat(
      last.passRate,
      rated.map((row) => row.passRate as number)
    ),
    failRate: rateStat(
      last.failRate,
      rated.map((row) => row.failRate as number)
    ),
    results: volumeStat(
      last.results,
      prior.map((row) => row.results)
    ),
    runs: volumeStat(
      last.runs,
      prior.map((row) => row.runs)
    ),
  };
}

/** Projects ordered by their total results in the window, most first. */
export function rankProjects(
  projects: TrendProject[],
  rows: ResultsTrendRow[]
): TrendProject[] {
  const totals = new Map<number, number>();
  for (const row of rows) {
    if (row.project === null) continue;
    totals.set(row.project.id, (totals.get(row.project.id) ?? 0) + row.results);
  }
  return [...projects].sort(
    (a, b) =>
      (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) ||
      a.name.localeCompare(b.name)
  );
}
