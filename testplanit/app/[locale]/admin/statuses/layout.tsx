import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
  const tCommon = await getTranslations("common");
  return { title: `Admin - ${tCommon("labels.statuses")}` };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
