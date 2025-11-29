import humanizeDuration, { Unit } from "humanize-duration";

/**
 * Options for the toHumanReadable function
 */
export interface HumanReadableOptions {
  /** Whether the input duration is in seconds (default is milliseconds) */
  isSeconds?: boolean;
  /** Whether to round the duration to the nearest unit */
  round?: boolean;
  /** The locale to use for formatting (e.g., "en", "es") */
  locale?: string;
  /** Specific units to use in the output (e.g., ["h", "m"] for hours and minutes only) */
  units?: Unit[];
  /** Maximum number of units to display (default: 3) */
  largest?: number;
  /** Maximum number of decimal points to show for the smallest unit (e.g., seconds) */
  maxDecimalPoints?: number;
}

/**
 * Convert milliseconds or seconds into a human-readable format.
 * @param duration - The duration in milliseconds or seconds.
 * @param options - Options for formatting the duration.
 * @returns A human-readable string (e.g., "1 day", "2 hours", "30 minutes").
 */
export function toHumanReadable(
  duration: number,
  options: HumanReadableOptions = {}
): string {
  const {
    isSeconds = false,
    round = true,
    locale = "en",
    units,
    largest = 3,
    maxDecimalPoints,
  } = options;

  const milliseconds = isSeconds ? duration * 1000 : duration;
  return humanizeDuration(milliseconds, {
    round,
    largest, // Use the provided largest value or default to 3
    units: units || ["y", "mo", "w", "d", "h", "m", "s"], // Available units
    language: locale.substring(0, 2),
    fallbacks: ["en"],
    ...(typeof maxDecimalPoints === "number" ? { maxDecimalPoints } : {}),
  });
}

/**
 * Calculate the number of business hours between two dates, considering:
 * - 8-hour workday (9 AM to 5 PM)
 * - Weekdays only (Monday to Friday)
 * - No holidays (can be enhanced later if needed)
 * @param start - Start date/time
 * @param end - End date/time
 * @returns The number of business hours (can be fractional)
 */
export function toBusinessHours(start: Date, end: Date): number {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  if (end <= start) return 0;

  let totalBusinessHours = 0;
  let current = new Date(start);

  // Helper: clamp a date to business hours (9am-5pm UTC)
  function clampToBusinessHours(date: Date): Date {
    const d = new Date(date);
    if (d.getUTCHours() < 9) d.setUTCHours(9, 0, 0, 0);
    if (d.getUTCHours() >= 17) d.setUTCHours(17, 0, 0, 0);
    return d;
  }

  // Move to the next business day at 9am UTC if outside business hours or on weekend
  function nextBusinessDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(9, 0, 0, 0);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return d;
  }

  while (current < end) {
    // Skip weekends
    if (current.getUTCDay() === 0 || current.getUTCDay() === 6) {
      current = nextBusinessDay(current);
      continue;
    }
    // Clamp current to business hours
    const businessStart = clampToBusinessHours(current);
    const businessEnd = new Date(businessStart);
    businessEnd.setUTCHours(17, 0, 0, 0);
    // If end is before businessEnd, only count up to end
    const intervalEnd = end < businessEnd ? end : businessEnd;
    if (intervalEnd > businessStart) {
      totalBusinessHours +=
        (intervalEnd.getTime() - businessStart.getTime()) / 3_600_000;
    }
    // Move to next business day
    current = nextBusinessDay(current);
  }
  return totalBusinessHours;
}
