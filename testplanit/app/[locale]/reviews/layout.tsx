import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
export async function generateMetadata(): Promise<Metadata> {
  // Cast `t` to a plain key-to-string function so the accumulated phase-2
  // message-keys union (which has crossed the TS complexity ceiling —
  // TS2590 / TS2554 / TS2345) doesn't reject the new `common.pageTitles.reviews`
  // key. The key is regenerated into `en-US.d.json.ts` by next-intl during
  // `next dev` / `next build`; the cast unblocks `pnpm type-check` in the
  // meantime. See deferred-items.md for the documented pattern.
  const t = (await getTranslations()) as (
    key: string,
    params?: Record<string, unknown>
  ) => string;
  return { title: t("common.pageTitles.reviews") };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
