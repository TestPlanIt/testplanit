import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { getLocale, getTranslations } from "next-intl/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import type { baseDb } from "~/lib/db";
import type { PreviewEntity } from "~/lib/linkPreview";
import { loadEntityPreview } from "~/lib/linkPreviewData";
import { parseRecordId } from "~/lib/recordKey";
import { authOptions } from "~/server/auth";

/**
 * Page metadata for record detail routes — the browser tab title and the Open
 * Graph card for anyone who shares the page while signed in.
 *
 * Reads the record through the *caller's* policy-enforced client, so a title
 * only ever names something that user can already see. Anonymous unfurl
 * fetches never reach here: `proxy.ts` routes those to `/api/link-preview`,
 * which applies its own (stricter) disclosure rules.
 */

/** Record kinds with a detail route that calls this. */
export type MetadataType = Exclude<PreviewEntity, "app">;

/** i18n key suffix per entity — mirrors the `linkPreview` namespace. */
const KEY_BY_ENTITY: Record<MetadataType, string> = {
  "test-case": "testCase",
  "test-run": "testRun",
  session: "session",
  project: "project",
  milestone: "milestone",
};

/**
 * Build the metadata for a record detail page.
 *
 * Never throws and never blocks the render: any failure falls back to the
 * generic card for that record kind.
 */
export async function fetchPageMetadata(
  type: MetadataType,
  id: string
): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "linkPreview" });

  const entityKey = KEY_BY_ENTITY[type];
  const label = t(`${entityKey}Label`);

  let title = t("genericTitle", { label });
  let description = t(`${entityKey}Generic`);

  const numericId = parseRecordId(id);
  if (numericId !== null) {
    try {
      const session = await getServerSession(authOptions);
      if (session?.user?.id) {
        const db = (await getEnhancedDb(session)) as unknown as typeof baseDb;
        const record = await loadEntityPreview(db, type, numericId);

        if (record) {
          const displayName = record.recordKey
            ? `${record.recordKey}: ${record.name}`
            : record.name;

          title = record.projectName
            ? t("namedTitle", {
                name: displayName,
                project: record.projectName,
              })
            : displayName;

          if (type === "test-run" && record.caseCount !== null) {
            description = t("testRunSummary", {
              count: record.caseCount,
              project: record.projectName ?? "",
            });
          } else if (
            type === "project" &&
            record.caseCount !== null &&
            record.runCount !== null
          ) {
            description = t("projectSummary", {
              cases: record.caseCount,
              runs: record.runCount,
            });
          } else {
            description = t("inProject", {
              label,
              project: record.projectName ?? "",
            });
          }
        }
      }
    } catch (error) {
      // An unreadable record is not a page failure — fall through to the
      // generic card rather than breaking the route's metadata.
      console.error("Page metadata lookup failed:", error);
    }
  }

  // `openGraph` and `twitter` are replaced wholesale by Next's shallow merge,
  // never merged into the root layout's versions — so every field the card
  // needs has to be repeated here.
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
