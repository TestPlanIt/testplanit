import {
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * Relative date ranges for reports.
 *
 * A report run can carry a relative range ("last week") beside the absolute
 * dates it resolved to. Every consumer of a stored run — a saved live report
 * reopening, a live share replaying, an API caller — resolves the relative
 * range again at view time through this module, so the report follows the
 * calendar instead of freezing on the dates picked at save time. A frozen
 * report resolves once, at capture.
 *
 * Resolution happens in ONE timezone, the one stored with the run (the
 * saver's preference): every viewer of a link sees the same range, and an
 * anonymous share viewer has no preference of their own to consult.
 */

/** The menu's presets, grouped the way both date pickers list them. */
export const DATE_RANGE_PRESET_CATEGORIES = {
  day: ["today", "yesterday", "last7Days", "last30Days"],
  week: ["thisWeek", "lastWeek", "last2Weeks"],
  month: ["thisMonth", "lastMonth", "last3Months"],
  quarter: ["thisQuarter", "lastQuarter"],
  year: ["thisYear", "lastYear", "last12Months"],
} as const;

export type DateRangePresetCategory = keyof typeof DATE_RANGE_PRESET_CATEGORIES;

export const DATE_RANGE_PRESETS = Object.values(
  DATE_RANGE_PRESET_CATEGORIES
).flat();

export type DateRangePresetKey = (typeof DATE_RANGE_PRESETS)[number];

export const ROLLING_RANGE_UNITS = ["days", "weeks", "months"] as const;
export type RollingRangeUnit = (typeof ROLLING_RANGE_UNITS)[number];

/** A rolling "last N" window stays within a sensible span. */
export const MAX_ROLLING_RANGE_AMOUNT = 999;

/** Weeks start on Monday, matching the pickers. */
export const WEEK_STARTS_ON = 1;

export type RelativeDateRange =
  | { preset: DateRangePresetKey }
  | { preset: "lastN"; amount: number; unit: RollingRangeUnit };

/** The body keys a relative range travels under, beside startDate/endDate. */
export interface RelativeDateRangeBody {
  dateRangePreset?: string | null;
  dateRangeAmount?: number | string | null;
  dateRangeUnit?: string | null;
  dateRangeTimezone?: string | null;
}

export interface ResolvedDateRange {
  /** The range's bounds as instants. */
  from: Date;
  to: Date;
  /** The same bounds as request-body strings. */
  startDate: string;
  endDate: string;
  /**
   * The bounds' calendar days in the resolution timezone, as local Dates —
   * what a calendar control highlights. Their time-of-day is meaningless.
   */
  fromDay: Date;
  toDay: Date;
}

export function isDateRangePresetKey(
  value: unknown
): value is DateRangePresetKey {
  return (
    typeof value === "string" &&
    (DATE_RANGE_PRESETS as readonly string[]).includes(value)
  );
}

function isRollingRangeUnit(value: unknown): value is RollingRangeUnit {
  return (
    typeof value === "string" &&
    (ROLLING_RANGE_UNITS as readonly string[]).includes(value)
  );
}

export function isValidTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== "string" || timezone === "") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The relative range a request body names, or null when it names none (or
 * names one badly — a malformed relative range falls back to the body's
 * absolute dates rather than failing the run).
 */
export function parseRelativeDateRange(
  body: RelativeDateRangeBody | null | undefined
): RelativeDateRange | null {
  const preset = body?.dateRangePreset;
  if (preset == null || preset === "") return null;
  if (preset === "lastN") {
    const amount = Number(body?.dateRangeAmount);
    const unit = body?.dateRangeUnit;
    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > MAX_ROLLING_RANGE_AMOUNT ||
      !isRollingRangeUnit(unit)
    ) {
      return null;
    }
    return { preset: "lastN", amount, unit };
  }
  return isDateRangePresetKey(preset) ? { preset } : null;
}

/** Two relative ranges that resolve identically. */
export function sameRelativeDateRange(
  a: RelativeDateRange | null,
  b: RelativeDateRange | null
): boolean {
  if (a === null || b === null) return a === b;
  if (a.preset !== b.preset) return false;
  if (a.preset === "lastN" && b.preset === "lastN") {
    return a.amount === b.amount && a.unit === b.unit;
  }
  return true;
}

/**
 * Resolves a relative range to absolute bounds as of `now`, on `timezone`'s
 * calendar. An unknown timezone resolves on UTC.
 *
 * Rolling windows keep the presets' own conventions so "last 7 days" typed
 * in equals the Last 7 Days preset: N days is today and the N−1 before it;
 * N weeks or months is today back to the same day N weeks or months ago.
 */
export function resolveRelativeDateRange(
  range: RelativeDateRange,
  options: { now?: Date; timezone?: string | null } = {}
): ResolvedDateRange {
  const timezone = isValidTimezone(options.timezone)
    ? options.timezone
    : "Etc/UTC";
  const now = options.now ?? new Date();
  // Wall-clock time on the timezone's calendar, carried in a local Date so
  // date-fns' calendar arithmetic applies to that calendar.
  const today = startOfDay(toZonedTime(now, timezone));
  const week = { weekStartsOn: WEEK_STARTS_ON } as const;

  let from: Date;
  let to: Date;
  switch (range.preset) {
    case "today":
      from = today;
      to = endOfDay(today);
      break;
    case "yesterday":
      from = subDays(today, 1);
      to = endOfDay(from);
      break;
    case "last7Days":
      from = subDays(today, 6);
      to = endOfDay(today);
      break;
    case "last30Days":
      from = subDays(today, 29);
      to = endOfDay(today);
      break;
    case "thisWeek":
      from = startOfWeek(today, week);
      to = endOfWeek(today, week);
      break;
    case "lastWeek": {
      const lastWeek = subWeeks(today, 1);
      from = startOfWeek(lastWeek, week);
      to = endOfWeek(lastWeek, week);
      break;
    }
    case "last2Weeks":
      from = subWeeks(today, 2);
      to = endOfDay(today);
      break;
    case "thisMonth":
      from = startOfMonth(today);
      to = endOfMonth(today);
      break;
    case "lastMonth": {
      const lastMonth = subMonths(today, 1);
      from = startOfMonth(lastMonth);
      to = endOfMonth(lastMonth);
      break;
    }
    case "last3Months":
      from = subMonths(today, 3);
      to = endOfDay(today);
      break;
    case "thisQuarter":
      from = startOfQuarter(today);
      to = endOfQuarter(today);
      break;
    case "lastQuarter": {
      const lastQuarter = subMonths(today, 3);
      from = startOfQuarter(lastQuarter);
      to = endOfQuarter(lastQuarter);
      break;
    }
    case "thisYear":
      from = startOfYear(today);
      to = endOfYear(today);
      break;
    case "lastYear": {
      const lastYear = subYears(today, 1);
      from = startOfYear(lastYear);
      to = endOfYear(lastYear);
      break;
    }
    case "last12Months":
      from = subMonths(today, 12);
      to = endOfDay(today);
      break;
    case "lastN":
      from =
        range.unit === "days"
          ? subDays(today, range.amount - 1)
          : range.unit === "weeks"
            ? subWeeks(today, range.amount)
            : subMonths(today, range.amount);
      to = endOfDay(today);
      break;
  }

  const fromInstant = fromZonedTime(from, timezone);
  const toInstant = fromZonedTime(to, timezone);
  return {
    from: fromInstant,
    to: toInstant,
    startDate: fromInstant.toISOString(),
    endDate: toInstant.toISOString(),
    fromDay: from,
    toDay: to,
  };
}

/**
 * The absolute dates a report run should use: the body's relative range
 * resolved as of now when it carries one, else the body's own dates. Every
 * report handler reads its dates through this, so a stored run replays on
 * today's calendar wherever it is replayed from.
 */
export function resolveRequestDateRange(
  body:
    | (RelativeDateRangeBody & { startDate?: unknown; endDate?: unknown })
    | null
    | undefined,
  now: Date = new Date()
): { startDate?: string; endDate?: string } {
  const relative = parseRelativeDateRange(body);
  if (relative) {
    const resolved = resolveRelativeDateRange(relative, {
      now,
      timezone: body?.dateRangeTimezone,
    });
    return { startDate: resolved.startDate, endDate: resolved.endDate };
  }
  return {
    startDate: typeof body?.startDate === "string" ? body.startDate : undefined,
    endDate: typeof body?.endDate === "string" ? body.endDate : undefined,
  };
}
