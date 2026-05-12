import { format, type Locale } from "date-fns";

import { dateFnsLocaleFor } from "~/i18n/dateFnsLocales";

export function getServerDateFnsLocale(locale: string): Locale {
  return dateFnsLocaleFor(locale);
}

/**
 * Format date with locale support
 */
export function formatDateWithLocale(
  date: Date | string,
  formatString: string,
  locale: string
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const dateLocale = getServerDateFnsLocale(locale);

  return format(dateObj, formatString, { locale: dateLocale });
}

/**
 * Format date for display in emails
 */
export function formatEmailDate(date: Date | string, locale: string): string {
  return formatDateWithLocale(date, "MMMM d, yyyy", locale);
}

/**
 * Format date and time for display in emails
 */
export function formatEmailDateTime(
  date: Date | string,
  locale: string
): string {
  // Use localized "at" word for different languages
  const atWordMap: Record<string, string> = {
    de: "um",
    en: "at",
    es: "a las",
    fr: "à",
    it: "alle",
    nl: "om",
    pl: "o",
    pt: "às",
    vi: "lúc",
  };

  const langCode = locale.substring(0, 2);
  const atWord = atWordMap[langCode] || "at";

  return formatDateWithLocale(date, `MMMM d, yyyy '${atWord}' hh:mm a`, locale);
}
