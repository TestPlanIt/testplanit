import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.pageTitles");
  return { title: t("advanced") };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
