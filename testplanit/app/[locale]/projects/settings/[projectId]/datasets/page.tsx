import { redirect } from "next/navigation";

import type { Locale } from "~/i18n/navigation";

export default async function LegacyDatasetsRedirect({
  params,
}: {
  params: Promise<{ locale: Locale; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  redirect(`/${locale}/projects/settings/${projectId}/parameters#datasets`);
}
