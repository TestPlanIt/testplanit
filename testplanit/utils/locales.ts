import { type Locale } from "date-fns";

import { dateFnsLocaleMap, dateFnsLocaleFor } from "~/i18n/dateFnsLocales";

export const getDateFnsLocale = (locale: string): Locale =>
  dateFnsLocaleFor(locale);

export { dateFnsLocaleMap };
