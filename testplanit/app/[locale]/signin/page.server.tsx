import { cookies, headers } from "next/headers";

import { locales, defaultLocale, type Locale } from "~/i18n/navigation";
import { redirect } from "~/lib/navigation";
import { COOKIE_PATH } from "~/lib/basePath";

export default async function SigninPage() {
  // Clear the NEXT_LOCALE cookie
  const cookieStore = await cookies();
  cookieStore.delete({ name: "NEXT_LOCALE", path: COOKIE_PATH });

  // Get browser's preferred language
  const headersList = await headers();
  const acceptLanguage = headersList.get("accept-language") ?? "";

  // Match the first supported locale whose language tag appears in Accept-Language
  const matched = locales.find((locale) =>
    acceptLanguage.includes(locale.substring(0, 2))
  );

  redirect({ href: `/signin`, locale: (matched ?? defaultLocale) as Locale });
}
