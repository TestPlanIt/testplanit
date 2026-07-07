// Text-direction support. Locales whose base language is listed here render
// right-to-left; everything else is left-to-right.
export const rtlLanguages = ["ar", "he", "fa", "ur"] as const;

export type Direction = "ltr" | "rtl";

/**
 * Resolve the text direction for a locale.
 *
 * Setting NEXT_PUBLIC_FORCE_RTL=true forces RTL regardless of locale so the
 * mirrored layout can be validated in English (or any LTR locale) without
 * Arabic translations being available yet. The flag is inlined at build time
 * by Next.js, so it applies to both server and client rendering.
 */
export function getLocaleDirection(locale: string): Direction {
  if (process.env.NEXT_PUBLIC_FORCE_RTL === "true") return "rtl";
  const language = locale.split("-")[0]?.toLowerCase();
  return (rtlLanguages as readonly string[]).includes(language ?? "")
    ? "rtl"
    : "ltr";
}
