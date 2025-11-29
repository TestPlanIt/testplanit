export const locales = [
  "en-US",
  "es-ES",
  "fr-FR",
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale = "en-US" as const;

export const languageNames: Record<string, string> = {
  "en-US": "English (US)",
  "es-ES": "Español (España)",
  "fr-FR": "Français (France)",
};
