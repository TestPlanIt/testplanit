import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Locale } from "~/i18n/navigation";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams?: Promise<{ reason?: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const reason = (await searchParams)?.reason;
  const t = await getTranslations({ locale });
  return {
    title: t(
      reason === "suspended"
        ? "common.pageTitles.instanceSuspended"
        : "common.pageTitles.trialExpired"
    ),
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
