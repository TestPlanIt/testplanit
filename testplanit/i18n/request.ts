import { getRequestConfig } from "next-intl/server";
import { Locale } from "./navigation";

export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment
  let locale = await requestLocale;

  // Ensure locale is always a string (fallback to en-US if undefined)
  if (!locale) {
    locale = "en-US";
  }

  return {
    locale: locale as Locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: "UTC",
  };
});
