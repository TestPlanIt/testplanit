import { getTranslations } from "next-intl/server";
import { NextResponse, type NextRequest } from "next/server";
import { baseDb } from "~/lib/db";
import { getLinkPreviewMode, type PreviewEntity } from "~/lib/linkPreview";
import { loadEntityPreview } from "~/lib/linkPreviewData";
import { defaultLocale, locales, type Locale } from "~/i18n/navigation";

/**
 * Metadata-only document served to link unfurlers (Slack, Teams, iMessage, …)
 * that request a protected deep link.
 *
 * `proxy.ts` rewrites those requests here rather than redirecting them to
 * /signin, which is what made every shared link preview identically. The
 * response contains a `<head>` and nothing else — no app shell, no session, and
 * no record data unless the instance set `LINK_PREVIEW_MODE=names`.
 *
 * A real browser that lands here (a user agent we misread as a bot) is sent on
 * to the sign-in page, exactly where an anonymous visitor was already headed.
 */

export const dynamic = "force-dynamic";

const PREVIEW_ENTITIES: readonly PreviewEntity[] = [
  "test-case",
  "test-run",
  "session",
  "project",
  "milestone",
  "app",
];

/** i18n key suffix per entity — `linkPreview.testRunLabel` and friends. */
const KEY_BY_ENTITY: Record<PreviewEntity, string> = {
  "test-case": "testCase",
  "test-run": "testRun",
  session: "session",
  project: "project",
  milestone: "milestone",
  app: "app",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Absolute origin for the URLs baked into the card. `og:url` and the sign-in
 * link are resolved by a fetcher sitting at a different network position than
 * the visitor, so relative URLs are not an option.
 */
function resolveBaseUrl(req: NextRequest): string {
  const configured = process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  // Rewritten requests carry their context in headers (a rewrite destination's
  // query string does not reach the handler); a direct GET can pass the same
  // fields as query params, which is how this route is exercised in tests.
  const query = req.nextUrl.searchParams;
  const params = {
    get: (key: string) =>
      req.headers.get(`x-link-preview-${key}`) ?? query.get(key),
  };

  const rawEntity = params.get("entity");
  const entity: PreviewEntity = PREVIEW_ENTITIES.includes(
    rawEntity as PreviewEntity
  )
    ? (rawEntity as PreviewEntity)
    : "app";

  const rawLocale = params.get("locale");
  const locale: Locale = (locales as readonly string[]).includes(
    rawLocale as string
  )
    ? (rawLocale as Locale)
    : defaultLocale;

  const parsedId = Number(params.get("id"));
  const id = Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : null;

  const path = params.get("path") ?? `/${locale}`;
  const baseUrl = resolveBaseUrl(req);
  const t = await getTranslations({ locale, namespace: "linkPreview" });

  const entityKey = KEY_BY_ENTITY[entity];
  const label = t(`${entityKey}Label`);

  // Safe default: the entity kind, derived from the URL shape alone.
  let title = t("genericTitle", { label });
  let description = t(`${entityKey}Generic`);

  // Opt-in: name the record. Anyone able to reach the URL sees this without
  // signing in, which is why it is off unless an admin turns it on.
  if (getLinkPreviewMode() === "names" && id !== null && entity !== "app") {
    const record = await loadEntityPreview(baseDb, entity, id);
    if (record) {
      const displayName = record.recordKey
        ? `${record.recordKey}: ${record.name}`
        : record.name;

      title = record.projectName
        ? t("namedTitle", { name: displayName, project: record.projectName })
        : displayName;

      if (entity === "test-run" && record.caseCount !== null) {
        description = t("testRunSummary", {
          count: record.caseCount,
          project: record.projectName ?? "",
        });
      } else if (
        entity === "project" &&
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

  const canonicalUrl = `${baseUrl}${path}`;
  const signInUrl = `${baseUrl}/${locale}/signin`;
  const siteName = t("siteName");
  const e = escapeHtml;

  const html = `<!doctype html>
<html lang="${e(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
<meta name="robots" content="noindex, nofollow">
<link rel="canonical" href="${e(canonicalUrl)}">
<meta property="og:site_name" content="${e(siteName)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${e(canonicalUrl)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:locale" content="${e(locale.replace("-", "_"))}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">
<meta http-equiv="refresh" content="0; url=${e(signInUrl)}">
</head>
<body>
<p>${e(description)} <a href="${e(signInUrl)}">${e(t("signInCta"))}</a></p>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Short enough that a renamed record refreshes quickly, long enough to
      // absorb the burst of fetchers a single paste triggers.
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
