// Ordered alphabetically by each language's native name (endonym).
// Latin-script languages first, then Arabic, Cyrillic, then CJK (no universal alpha order).
export const locales = [
  "cs-CZ",
  "de-DE",
  "en-US",
  "es-ES",
  "fr-FR",
  "it-IT",
  "nl-NL",
  "pl-PL",
  "pt-BR",
  "tr-TR",
  "vi-VN",
  "ar-SA",
  "ru-RU",
  "zh-CN",
  "zh-TW",
  "ja-JP",
  "ko-KR",
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale = "en-US" as const;

/**
 * Convert a Prisma `Locale` enum value (`en_US`) to the BCP-47 tag next-intl
 * uses (`en-US`), falling back to `defaultLocale` for unset/unknown values.
 *
 * Server-side senders (emails, notifications, and Server Actions that persist
 * user-visible text) localize to the actor's stored preference rather than to
 * whatever `[locale]` segment the request happened to carry, matching the
 * convention in `lib/email/*` and `lib/services/*`. Threading it explicitly
 * also keeps `getTranslations({locale})` independent of how `i18n/request.ts`
 * resolves an absent locale — a bare `getTranslations()` inherits that
 * resolution, which has already broken once inside a Server Action (the
 * `next/root-params` attempt reverted in 9919fa7e).
 *
 * The membership check is a plain `includes` rather than next-intl's
 * `hasLocale` to keep this module dependency-free — `proxy.ts` imports it.
 */
export function localeFromPreference(value: string | null | undefined): Locale {
  const tag = (value ?? "").replace("_", "-");
  return (locales as readonly string[]).includes(tag)
    ? (tag as Locale)
    : defaultLocale;
}

export const languageNames: Record<string, string> = {
  "cs-CZ": "Čeština (Česko)",
  "de-DE": "Deutsch (Deutschland)",
  "en-US": "English (US)",
  "es-ES": "Español (España)",
  "fr-FR": "Français (France)",
  "it-IT": "Italiano (Italia)",
  "nl-NL": "Nederlands (Nederland)",
  "pl-PL": "Polski (Polska)",
  "pt-BR": "Português (Brasil)",
  "tr-TR": "Türkçe (Türkiye)",
  "vi-VN": "Tiếng Việt",
  "ar-SA": "العربية",
  "ru-RU": "Русский (Россия)",
  "zh-CN": "中文（简体）",
  "zh-TW": "中文（繁體）",
  "ja-JP": "日本語",
  "ko-KR": "한국어",
};
