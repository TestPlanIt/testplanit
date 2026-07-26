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
