import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.menu");
  return { title: `Admin - ${t("workflows")}` };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
