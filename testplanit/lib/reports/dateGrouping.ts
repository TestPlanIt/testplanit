/**
 * Calendar bucketing shared by every report with a date axis.
 *
 * All arithmetic is in UTC: the aggregates key rows by the UTC start of the
 * period they fall in, and the drill-down, chart and table read those keys
 * back with the same calendar. Weeks run Monday to Sunday.
 *
 * Pure module — no server imports — so the client formats period labels with
 * the same boundaries the server grouped by.
 */

export const DATE_GROUPINGS = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "annually",
] as const;

export type DateGrouping = (typeof DATE_GROUPINGS)[number];

export function isDateGrouping(value: unknown): value is DateGrouping {
  return (
    typeof value === "string" &&
    (DATE_GROUPINGS as readonly string[]).includes(value)
  );
}

/** The period containing `date`: start at 00:00:00.000, end at 23:59:59.999. */
export function getPeriodDates(
  date: Date,
  grouping: DateGrouping
): { start: Date; end: Date } {
  const utcDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );

  switch (grouping) {
    case "daily": {
      const start = new Date(utcDate);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(utcDate);
      end.setUTCHours(23, 59, 59, 999);
      return { start, end };
    }
    case "weekly": {
      const start = new Date(utcDate);
      const day = start.getUTCDay();
      const daysSinceMonday = day === 0 ? 6 : day - 1;
      start.setUTCDate(start.getUTCDate() - daysSinceMonday);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      end.setUTCHours(23, 59, 59, 999);
      return { start, end };
    }
    case "monthly": {
      const start = new Date(
        Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), 1, 0, 0, 0, 0)
      );
      const end = new Date(
        Date.UTC(
          utcDate.getUTCFullYear(),
          utcDate.getUTCMonth() + 1,
          1,
          0,
          0,
          0,
          0
        )
      );
      end.setUTCMilliseconds(-1);
      return { start, end };
    }
    case "quarterly": {
      const quarter = Math.floor(utcDate.getUTCMonth() / 3);
      const start = new Date(
        Date.UTC(utcDate.getUTCFullYear(), quarter * 3, 1, 0, 0, 0, 0)
      );
      const end = new Date(
        Date.UTC(utcDate.getUTCFullYear(), quarter * 3 + 3, 1, 0, 0, 0, 0)
      );
      end.setUTCMilliseconds(-1);
      return { start, end };
    }
    case "annually": {
      const start = new Date(
        Date.UTC(utcDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0)
      );
      const end = new Date(
        Date.UTC(utcDate.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0)
      );
      end.setUTCMilliseconds(-1);
      return { start, end };
    }
    default:
      return getPeriodDates(date, "weekly");
  }
}

/**
 * Contiguous periods spanning [lo, hi] at the given grouping. Fills gaps so a
 * cumulative series stays continuous where no activity landed.
 */
export function generatePeriods(
  lo: Date,
  hi: Date,
  grouping: DateGrouping
): { start: Date; end: Date }[] {
  const periods: { start: Date; end: Date }[] = [];
  if (lo > hi) return periods;

  let cursor = getPeriodDates(lo, grouping).start;
  const hiTime = hi.getTime();
  let guard = 0;
  while (cursor.getTime() <= hiTime && guard < 100000) {
    const period = getPeriodDates(cursor, grouping);
    periods.push(period);
    cursor = new Date(period.end.getTime() + 1);
    guard++;
  }
  return periods;
}

/**
 * The ISO timestamp of the start of the period `value` falls in. This is the
 * group key the aggregates write for a date dimension, and what the table,
 * chart, CSV and drill-down read back.
 */
export function bucketDateIso(
  value: Date | string,
  grouping: DateGrouping = "daily"
): string {
  const date = value instanceof Date ? value : new Date(value);
  return getPeriodDates(date, grouping).start.toISOString();
}

/**
 * Half-open bounds of the period `value` falls in, for a Prisma date filter:
 * `gte` the period start, `lt` the next period's start.
 */
export function periodBoundsUtc(
  value: Date | string,
  grouping: DateGrouping = "daily"
): { gte: Date; lt: Date } {
  const date = value instanceof Date ? value : new Date(value);
  const { start, end } = getPeriodDates(date, grouping);
  return { gte: start, lt: new Date(end.getTime() + 1) };
}
