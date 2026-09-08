import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { baseDb } from "~/lib/db";
import type { Locale } from "~/i18n/navigation";

/**
 * Share links are public by design, so their preview cards can name what was
 * shared — with two exceptions: an AUTHENTICATED or PASSWORD_PROTECTED share
 * gates its content behind a check the unfurl fetch never passes, so naming it
 * in a chat card would hand out exactly what the gate withholds. Those fall
 * back to the generic card, as do revoked, expired, and deleted links.
 */

/** i18n key suffix per share entity kind. */
const LABEL_KEY: Record<string, string> = {
  REPORT: "shareReportLabel",
  TEST_CASE: "testCaseLabel",
  TEST_RUN: "testRunLabel",
  SESSION: "sessionLabel",
  DASHBOARD: "shareDashboardLabel",
  SEARCH: "shareSearchLabel",
  REPOSITORY_VIEW: "shareViewLabel",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale; shareKey: string }>;
}): Promise<Metadata> {
  const { locale, shareKey } = await params;
  const t = await getTranslations({ locale, namespace: "linkPreview" });

  let label = t("shareReportLabel");
  let title = t("genericTitle", { label });
  let description = t("shareGeneric");

  try {
    const share = await baseDb.shareLink.findUnique({
      where: { shareKey },
      select: {
        entityType: true,
        mode: true,
        title: true,
        isRevoked: true,
        isDeleted: true,
        expiresAt: true,
        project: { select: { name: true } },
      },
    });

    const usable =
      share &&
      !share.isDeleted &&
      !share.isRevoked &&
      (!share.expiresAt || new Date(share.expiresAt) > new Date());

    if (share && !usable) {
      description = t("shareUnavailable");
    } else if (share) {
      label = t(LABEL_KEY[share.entityType] ?? "shareReportLabel");
      title = t("genericTitle", { label });

      if (share.mode === "PUBLIC") {
        if (share.title) title = share.title;
        if (share.project?.name) {
          description = t("shareInProject", { project: share.project.name });
        }
      }
    }
  } catch (error) {
    console.error("Share link metadata lookup failed:", error);
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: t("siteName"),
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
