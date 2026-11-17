import { formatInTimeZone } from "date-fns-tz";
import { getPeriodDates, type DateGrouping } from "~/lib/reports/dateGrouping";
import { getDateFnsLocale } from "~/utils/locales";

/**
 * Labels for a report's date rows. A row carries the UTC start of the
 * period it covers (see lib/reports/dateGrouping); the label spells out the
 * period at the grouping's natural precision: the day, the week's first and
 * last days, the month, the quarter, the year.
 */

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function formatUtc(date: Date, pattern: string, locale: string): string {
  return formatInTimeZone(date, "UTC", pattern, {
    locale: getDateFnsLocale(locale),
  });
}

/** Locale-aware label for the table, chart tooltips and drill-down header. */
export function formatReportPeriod(
  value: string | Date | null | undefined,
  grouping: DateGrouping,
  locale: string
): string {
  if (!value) return "";
  const date = toDate(value);
  if (!date) return "";
  const { start, end } = getPeriodDates(date, grouping);
  switch (grouping) {
    case "weekly":
      return `${formatUtc(start, "PP", locale)} - ${formatUtc(end, "PP", locale)}`;
    case "monthly":
      return formatUtc(start, "MMM yyyy", locale);
    case "quarterly":
      return formatUtc(start, "QQQ yyyy", locale);
    case "annually":
      return formatUtc(start, "yyyy", locale);
    case "daily":
    default: {
      // Read the UTC calendar day and render it through the locale at noon
      // so no timezone shifts it onto a neighbouring day.
      const year = start.getUTCFullYear();
      const month = String(start.getUTCMonth() + 1).padStart(2, "0");
      const day = String(start.getUTCDate()).padStart(2, "0");
      return new Date(
        `${year}-${month}-${day}T12:00:00.000Z`
      ).toLocaleDateString(locale);
    }
  }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Locale-independent label for CSV exports. */
export function formatReportPeriodIso(
  value: string | Date | null | undefined,
  grouping: DateGrouping
): string {
  if (!value) return "";
  const date = toDate(value);
  if (!date) return "";
  const { start, end } = getPeriodDates(date, grouping);
  switch (grouping) {
    case "weekly":
      return `${isoDay(start)} \u2013 ${isoDay(end)}`;
    case "monthly":
      return isoDay(start).slice(0, 7);
    case "quarterly":
      return `${start.getUTCFullYear()}-Q${Math.floor(start.getUTCMonth() / 3) + 1}`;
    case "annually":
      return String(start.getUTCFullYear());
    case "daily":
    default:
      return isoDay(start);
  }
}
