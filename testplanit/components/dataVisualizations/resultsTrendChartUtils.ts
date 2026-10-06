import { getDateFnsLocale } from "~/utils/locales";
import { format, parseISO } from "date-fns";
import type { DateGrouping } from "~/lib/reports/dateGrouping";
import type { ResultBucket } from "~/utils/resultsTrendShared";

/** Status colours: pass and fail are verdicts, so they wear the status hues. */
export const TREND_COLORS = {
  passRate: "#22c55e",
  failRate: "#ef4444",
  volume: "#64748b",
  passed: "#22c55e",
  failed: "#ef4444",
  skipped: "#94a3b8",
  other: "#f59e0b",
} as const;

export const BUCKET_ORDER: ResultBucket[] = [
  "passed",
  "failed",
  "skipped",
  "other",
];

const SHORT_PATTERN: Record<DateGrouping, string> = {
  daily: "MMM d",
  weekly: "MMM d",
  monthly: "MMM yyyy",
  quarterly: "QQQ yyyy",
  annually: "yyyy",
};

const LONG_PATTERN: Record<DateGrouping, string> = {
  daily: "PP",
  weekly: "PP",
  monthly: "MMMM yyyy",
  quarterly: "QQQ yyyy",
  annually: "yyyy",
};

/** A period key (`YYYY-MM-DD`) as a short axis label, e.g. "Sep 22". */
export function periodLabel(
  periodStart: string,
  grouping: DateGrouping,
  locale: string
): string {
  return format(parseISO(periodStart), SHORT_PATTERN[grouping], {
    locale: getDateFnsLocale(locale),
  });
}

/** A period key as a full label, for tooltips, tiles and the table. */
export function periodLongLabel(
  periodStart: string,
  grouping: DateGrouping,
  locale: string
): string {
  return format(parseISO(periodStart), LONG_PATTERN[grouping], {
    locale: getDateFnsLocale(locale),
  });
}

/** `62.5` → "62.5%"; null → an em dash. */
export function formatRate(
  rate: number | null | undefined,
  locale: string,
  digits = 1
): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "—";
  return `${rate.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })}%`;
}

/** A signed change: "+2.3" / "−1.0" / "0.0". */
export function formatSigned(
  value: number,
  locale: string,
  digits = 1
): string {
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  const text = Math.abs(rounded).toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (rounded > 0) return `+${text}`;
  if (rounded < 0) return `−${text}`;
  return text;
}

/** One tooltip line; `color` draws the status pip that keys the figure. */
export interface TrendTooltipLine {
  label: string;
  value: string;
  color?: string;
}

export interface TrendTooltip {
  x: number;
  y: number;
  lines: TrendTooltipLine[];
  title: string;
}
