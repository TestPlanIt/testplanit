import { format } from "date-fns";
import { getDateFnsLocale } from "~/utils/locales";

/**
 * Format a start–end date range into a single localized string, e.g.
 * "Aug 26, 2025 – Sep 27, 2025". Falls back to whichever side is present when
 * only one date is set, and returns undefined when neither is.
 *
 * Uses date-fns + the app's `getDateFnsLocale` (pass `useLocale()` in), matching
 * the DateFormatter / DateRangePicker convention rather than raw
 * `toLocaleDateString`, so ranges localize consistently across the app.
 */
export function formatDateRange(
  start?: Date | string | null,
  end?: Date | string | null,
  opts?: { locale?: string; formatStr?: string; separator?: string }
): string | undefined {
  const formatStr = opts?.formatStr ?? "MMM d, yyyy";
  const separator = opts?.separator ?? "–";
  const localeObj = getDateFnsLocale(opts?.locale ?? "en-US");
  const fmt = (d?: Date | string | null) =>
    d ? format(new Date(d), formatStr, { locale: localeObj }) : null;
  const s = fmt(start);
  const e = fmt(end);
  if (s && e) return `${s} ${separator} ${e}`;
  return s ?? e ?? undefined;
}
