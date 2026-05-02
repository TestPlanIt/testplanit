import { type Locale, enUS, es, fr } from "date-fns/locale";

export function dateFnsLocaleFor(appLocale: string): Locale {
  if (appLocale.startsWith("fr")) return fr;
  if (appLocale.startsWith("es")) return es;
  return enUS;
}
