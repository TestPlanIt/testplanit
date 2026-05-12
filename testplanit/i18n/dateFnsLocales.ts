import { type Locale } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { de } from "date-fns/locale/de";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";
import { it } from "date-fns/locale/it";
import { nl } from "date-fns/locale/nl";
import { pl } from "date-fns/locale/pl";
import { ptBR } from "date-fns/locale/pt-BR";
import { vi } from "date-fns/locale/vi";
import { zhCN } from "date-fns/locale/zh-CN";
import { zhTW } from "date-fns/locale/zh-TW";
import { ja } from "date-fns/locale/ja";
import { ko } from "date-fns/locale/ko";

import { locales } from "./navigation";

export const dateFnsLocaleMap: Record<string, Locale> = {
  "de-DE": de,
  "en-US": enUS,
  "es-ES": es,
  "fr-FR": fr,
  "it-IT": it,
  "nl-NL": nl,
  "pl-PL": pl,
  "pt-BR": ptBR,
  "vi-VN": vi,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "ja-JP": ja,
  "ko-KR": ko,
};

export function dateFnsLocaleFor(appLocale: string): Locale {
  if (!appLocale) return enUS;
  const normalized = appLocale.replace("_", "-");
  return dateFnsLocaleMap[normalized] ?? enUS;
}

export { locales };
