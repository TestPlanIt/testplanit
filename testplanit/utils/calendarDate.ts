/**
 * Helpers for dates that mean a **day on the calendar** rather than an instant.
 *
 * Milestone start/due dates are the case that forced these: Jira hands a
 * version's dates over as bare `yyyy-MM-dd` strings with no time and no offset,
 * and a date picker's output only ever means "the day the user clicked". Both
 * land in `timestamptz` columns, so the app-wide convention is:
 *
 *   - **write** them pinned to UTC midnight of that day, and
 *   - **read** them formatted in UTC, never in the viewer's timezone.
 *
 * Converting them into a viewer's zone is what made a Jira release dated
 * Aug 13 render as "Aug 12, 7:00 PM" for a reader in GMT-5, and flip to past
 * due a full day early. A calendar date has no instant to convert, so the fix
 * is to stop converting rather than to shift what is stored.
 *
 * Dates that *are* instants — a run's completion time, a Jira sprint's
 * boundaries — keep converting normally and must not use these helpers.
 */

/**
 * The zone calendar dates are formatted in. Named rather than inlined so the
 * read side is greppable against the write side.
 */
export const CALENDAR_DATE_TIMEZONE = "Etc/UTC";

/**
 * Pins a picker-produced Date to UTC midnight of the day it displays as.
 *
 * react-day-picker builds its Date from the browser's local calendar, so it is
 * the **local** Y/M/D that carry the clicked day; the UTC ones are already off
 * by one for any viewer west of Greenwich.
 */
export function toCalendarDate(date: Date): Date {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
}

/**
 * The inverse: turns a stored UTC-midnight calendar date back into local
 * midnight of the same day, which is the frame react-day-picker and date-fns
 * `format` both read. Without this a stored Aug 13 arrives at the picker as
 * Aug 12 for anyone in a negative offset, highlighting the wrong cell.
 */
export function fromCalendarDate(date: Date): Date {
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * The `yyyy-MM-dd` day a calendar date falls on. Timezone-independent by
 * construction, unlike the viewer-relative day key instants need.
 */
export function calendarDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * True when `date`'s calendar day is strictly earlier than the day `now` falls
 * on **where the reader is**. This is the comparison a due date wants: a
 * milestone due Aug 13 is not overdue at any point during Aug 13 for that
 * reader, and becomes overdue once their own calendar rolls to Aug 14.
 *
 * `now` is read in local time on purpose — every caller runs in the browser,
 * so local time *is* the reader's time.
 */
export function isCalendarDayBefore(date: Date, now: Date): boolean {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return fromCalendarDate(date).getTime() < today.getTime();
}

/**
 * True when `date`'s calendar day is strictly later than the reader's own day —
 * the mirror of {@link isCalendarDayBefore}, for "upcoming" checks.
 */
export function isCalendarDayAfter(date: Date, now: Date): boolean {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return fromCalendarDate(date).getTime() > today.getTime();
}

/**
 * Widens a calendar date into a usable instant, for the awkward case where a
 * day chosen by a user has to land in a field that genuinely holds a moment —
 * a test run's or session's `completedAt`, cascaded from the day a milestone
 * was marked complete.
 *
 * Noon UTC is the anchor because those fields *are* rendered in the viewer's
 * timezone: UTC midnight would show up as the previous evening anywhere west
 * of Greenwich, which is the very bug this module exists to prevent. Noon
 * holds the intended day for every offset from UTC-12 to UTC+11, leaving only
 * UTC+13/+14 (Samoa, Tonga, NZ in DST) reading a day late.
 *
 * Prefer the real instant wherever one is actually known — this is strictly
 * for widening a day the user picked.
 */
export function calendarDateToInstant(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      12,
      0,
      0
    )
  );
}

/**
 * Parses an upstream tracker value that may be either a bare `yyyy-MM-dd`
 * calendar date or a full timestamp, and reports which it was.
 *
 * The distinction matters because both shapes arrive through the same Jira
 * milestone pipeline: a version's `startDate`/`releaseDate` are date-only,
 * while a sprint's `startDate`/`endDate` are real instants that must keep
 * their time. `new Date()` happens to parse the date-only form to UTC
 * midnight already — this states that dependency instead of relying on it.
 */
export function parseUpstreamDate(value: string): {
  date: Date;
  isCalendarDate: boolean;
} {
  const isCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  return {
    date: isCalendarDate
      ? new Date(`${value.trim()}T00:00:00.000Z`)
      : new Date(value),
    isCalendarDate,
  };
}
