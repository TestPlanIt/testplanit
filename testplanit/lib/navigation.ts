import { createNavigation } from "next-intl/navigation";
import { languageNames, locales } from "~/i18n/navigation";

export const { Link, redirect, usePathname, useRouter } = createNavigation({
  locales,
});
export { locales, languageNames };
