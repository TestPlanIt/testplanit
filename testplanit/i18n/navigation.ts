// Ordered alphabetically by each language's native name (endonym).
// Latin-script languages first, CJK at the end (no universal alpha order).
export const locales = [
  "de-DE",
  "en-US",
  "es-ES",
  "fr-FR",
  "it-IT",
  "nl-NL",
  "pl-PL",
  "pt-BR",
  "vi-VN",
  "zh-CN",
  "zh-TW",
  "ja-JP",
  "ko-KR",
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale = "en-US" as const;

export const languageNames: Record<string, string> = {
  "de-DE": "Deutsch (Deutschland)",
  "en-US": "English (US)",
  "es-ES": "Español (España)",
  "fr-FR": "Français (France)",
  "it-IT": "Italiano (Italia)",
  "nl-NL": "Nederlands (Nederland)",
  "pl-PL": "Polski (Polska)",
  "pt-BR": "Português (Brasil)",
  "vi-VN": "Tiếng Việt",
  "zh-CN": "中文（简体）",
  "zh-TW": "中文（繁體）",
  "ja-JP": "日本語",
  "ko-KR": "한국어",
};
