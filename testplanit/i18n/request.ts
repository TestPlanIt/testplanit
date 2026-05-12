import { getRequestConfig } from "next-intl/server";
import { Locale } from "./navigation";

export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment
  let locale = await requestLocale;

  // Ensure locale is always a string (fallback to en-US if undefined)
  if (!locale) {
    locale = "en-US";
  }

  const messages = await import(`../messages/${locale}.json`).catch(
    () => import("../messages/en-US.json")
  );

  return {
    locale: locale as Locale,
    messages: messages.default,
    timeZone: "UTC",
  };
});
