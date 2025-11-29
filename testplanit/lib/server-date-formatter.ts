import { format } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";
import { Locale } from "date-fns";

// Map locales to date-fns locales
const localeMap: Record<string, Locale> = {
  "en-US": enUS,
  "en_US": enUS,
  "es-ES": es,
  "es_ES": es,
  "fr-FR": fr,
  "fr_FR": fr,
};

/**
 * Get date-fns locale from locale string
 */
export function getServerDateFnsLocale(locale: string): Locale {
  // Normalize locale format
  const normalizedLocale = locale.replace('_', '-');
  return localeMap[normalizedLocale] || localeMap[locale] || enUS;
}

/**
 * Format date with locale support
 */
export function formatDateWithLocale(
  date: Date | string,
  formatString: string,
  locale: string
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const dateLocale = getServerDateFnsLocale(locale);
  
  return format(dateObj, formatString, { locale: dateLocale });
}

/**
 * Format date for display in emails
 */
export function formatEmailDate(date: Date | string, locale: string): string {
  return formatDateWithLocale(date, 'MMMM d, yyyy', locale);
}

/**
 * Format date and time for display in emails
 */
export function formatEmailDateTime(date: Date | string, locale: string): string {
  // Use localized "at" word for different languages
  const atWordMap: Record<string, string> = {
    'en': 'at',
    'es': 'a las',
    'fr': 'à',
  };

  const langCode = locale.substring(0, 2);
  const atWord = atWordMap[langCode] || 'at';

  return formatDateWithLocale(date, `MMMM d, yyyy '${atWord}' hh:mm a`, locale);
}