import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Locale } from "~/i18n/navigation";

/**
 * The sign-in page is the one app route an anonymous visitor is meant to land
 * on, so it carries a real card of its own rather than inheriting the root
 * layout's app-wide description.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  const preview = await getTranslations({ locale, namespace: "linkPreview" });

  const title = preview("signInTitle");
  const description = preview("signInDescription");
  return {
    title: t("common.pageTitles.signIn"),
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: preview("siteName"),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
