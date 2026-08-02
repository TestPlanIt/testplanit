import type { NumberValue } from "d3";

/**
 * Formats a number using the app's active locale rather than the browser's.
 *
 * `Number.prototype.toLocaleString()` with no argument falls back to the
 * runtime's locale, which is the browser's — not the locale the user picked in
 * their preferences. Always pass the locale from `useLocale()`.
 */
export function formatNumber(value: number, locale: string): string {
  return value.toLocaleString(locale);
}

/**
 * Builds a d3 axis tick formatter bound to the app's active locale.
 *
 * d3's default tick format groups thousands with a hardcoded `,` (its built-in
 * locale definition is en-US), so axes read `25,000` even in locales that
 * separate with `.` or a space. Pass this to `.tickFormat()` on numeric scales.
 */
export function localeTickFormat(locale: string) {
  return (value: NumberValue): string => Number(value).toLocaleString(locale);
}

/**
 * Builds a d3 axis tick formatter for duration values in SECONDS, rendered
 * compactly ("45s", "5m 10s", "2h 5m") so elapsed-time axes read as time
 * rather than raw numbers. At most two units are shown; sub-second ticks
 * keep up to two decimals.
 */
export function durationTickFormat() {
  return (value: NumberValue): string => {
    const total = Number(value);
    if (!Number.isFinite(total)) return "";
    const sign = total < 0 ? "-" : "";
    const abs = Math.abs(total);
    if (abs === 0) return "0s";
    if (abs < 1) {
      return `${sign}${abs.toFixed(2).replace(/\.?0+$/, "")}s`;
    }
    const hours = Math.floor(abs / 3600);
    const minutes = Math.floor((abs % 3600) / 60);
    const seconds = Math.round(abs % 60);
    const parts: string[] = [];
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (seconds || parts.length === 0) parts.push(`${seconds}s`);
    return sign + parts.slice(0, 2).join(" ");
  };
}
