import type { Locale } from "~/i18n/navigation";
import { redirect } from "~/lib/navigation";

export default async function LegacyDatasetsRedirect({
  params,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  redirect({
    href: `/projects/settings/${projectId}/parameters#datasets`,
    locale,
  });
}
