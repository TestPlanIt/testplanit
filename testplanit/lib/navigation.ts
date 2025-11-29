import { createNavigation } from "next-intl/navigation";
import { locales, languageNames } from "~/i18n/navigation";

export const { Link, redirect, usePathname, useRouter } = createNavigation({
  locales,
});
export { locales, languageNames };
