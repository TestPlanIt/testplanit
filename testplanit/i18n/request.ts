import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import * as rootParams from "next/root-params";
import { Locale, locales } from "./navigation";

export default getRequestConfig(async ({ locale }) => {
  // An explicit locale (e.g. getTranslations({locale}) from email/notification
  // code) takes precedence. Otherwise read the [locale] root param — unlike
  // headers(), next/root-params is static-safe and keeps routes prerenderable.
  if (!locale) {
    const paramValue = await rootParams.locale();
    locale = hasLocale(locales, paramValue) ? paramValue : "en-US";
  }

  const messages = await import(`../messages/${locale}.json`).catch(
    () => import(`../messages/en-US.json`)
  );

  return {
    locale: locale as Locale,
    messages: messages.default,
    timeZone: "UTC",
  };
});
