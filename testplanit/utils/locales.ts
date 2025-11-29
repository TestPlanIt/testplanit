import { Locale } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";

// Map next-intl locales to date-fns locales
const localeMap: Record<string, Locale> = {
  "en-US": enUS,
  "es-ES": es,
  "fr-FR": fr,
};

export const getDateFnsLocale = (locale: string): Locale => {
  return localeMap[locale] || enUS; // Default to English if locale not found
};
