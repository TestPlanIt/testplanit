import * as z from "zod/v4";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date filter bound: a calendar day (`YYYY-MM-DD`, read as a UTC day) or a
 * full ISO 8601 timestamp with a `Z` or offset.
 */
export const dateBoundSchema = z.union([
  z.iso.date(),
  z.iso.datetime({ offset: true }),
]);

export const DATE_BOUND_HELP =
  "YYYY-MM-DD (a whole UTC day: a start bound begins at 00:00:00Z, an end bound runs through 23:59:59.999Z) or an ISO 8601 timestamp with Z/offset";

/**
 * Turn a filter bound into the instant to compare against. A date-only start
 * is the beginning of that UTC day and a date-only end is the last instant of
 * it, matching the web app's report and audit-log date ranges, where a range
 * ending on a day includes the whole day. Timestamps pass through unchanged.
 */
export function parseDateBound(value: string, kind: "start" | "end"): Date {
  if (DATE_ONLY.test(value)) {
    return new Date(
      kind === "start" ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`,
    );
  }
  return new Date(value);
}
