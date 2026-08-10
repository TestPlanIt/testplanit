import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Locale } from "~/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // Cast `t` to a plain key-to-string function so the accumulated phase-2
  // message-keys union (which has crossed the TS complexity ceiling —
  // TS2590 / TS2554 / TS2345) doesn't reject the new `common.pageTitles.reviews`
  // key. The key is regenerated into `en-US.d.json.ts` by next-intl during
  // `next dev` / `next build`; the cast unblocks `pnpm type-check` in the
  // meantime. See deferred-items.md for the documented pattern.
  const t = (await getTranslations({ locale })) as (
    key: string,
    params?: Record<string, unknown>
  ) => string;
  return { title: t("common.pageTitles.reviews") };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
