import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Locale } from "~/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("common.pageTitles.issues") };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
