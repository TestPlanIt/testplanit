/**
 * Link unfurl (Open Graph) support for deep links into protected routes.
 *
 * Chat clients fetch a URL with no cookies to build their preview card, so
 * every deep link would otherwise hit the auth guard in `proxy.ts` and be
 * redirected to `/signin` — which is why every share of a run, case or session
 * used to unfurl as the same generic app card.
 *
 * The middleware instead rewrites those requests to `/api/link-preview`, which
 * renders a metadata-only document. Nothing from the app shell, and no record
 * data unless the instance opts in (see {@link getLinkPreviewMode}).
 *
 * Previews carry no `og:image` — the card is title and description only, which
 * is what chat clients headline anyway.
 *
 * Everything here is pure string handling so it can run in the middleware
 * runtime — no Prisma, no Node built-ins.
 */

/** Entity kinds that get a tailored preview card. */
export type PreviewEntity =
  "test-case" | "test-run" | "session" | "project" | "milestone" | "app";

export interface PreviewRouteMatch {
  entity: PreviewEntity;
  /** Numeric record id, or null for routes that identify no single record. */
  id: number | null;
}

/**
 * How much a preview may reveal to an anonymous fetcher.
 *
 * - `safe` (default): the entity *kind* only — "Test Run · TestPlanIt". Derived
 *   from the URL shape, so nothing is read from the database and nothing can
 *   leak into a channel the record's project members can't see.
 * - `names`: the record's own name and its project name. Anyone who can reach
 *   the URL sees them without signing in, so this is opt-in per instance.
 */
export type LinkPreviewMode = "safe" | "names";

export function getLinkPreviewMode(): LinkPreviewMode {
  return process.env.LINK_PREVIEW_MODE === "names" ? "names" : "safe";
}

/**
 * Route shapes that carry a previewable record, most specific first.
 *
 * Patterns run against the locale-stripped pathname and only ever match a bare
 * numeric id — `proxy.ts` has already redirected cosmetic prefixed keys
 * (`PROJECT-TC-1234`) to their canonical numeric form by this point.
 *
 * The trailing `(?:\/|$)` lets sub-routes (a test case `/{version}`, a run's
 * tabs) resolve to their parent record rather than falling through to `app`.
 */
const PREVIEW_ROUTE_PATTERNS: readonly {
  entity: PreviewEntity;
  pattern: RegExp;
}[] = [
  {
    entity: "test-case",
    pattern: /^\/projects\/repository\/\d+\/(\d+)(?:\/|$)/,
  },
  { entity: "test-case", pattern: /^\/case\/(\d+)(?:\/|$)/ },
  { entity: "test-run", pattern: /^\/projects\/runs\/\d+\/(\d+)(?:\/|$)/ },
  { entity: "session", pattern: /^\/projects\/sessions\/\d+\/(\d+)(?:\/|$)/ },
  {
    entity: "milestone",
    pattern: /^\/projects\/milestones\/\d+\/(\d+)(?:\/|$)/,
  },
  { entity: "milestone", pattern: /^\/milestone\/(\d+)(?:\/|$)/ },
  // Any other project-scoped route (overview, list pages, settings) previews as
  // the project itself — one id, and it's the most useful thing to name.
  { entity: "project", pattern: /^\/projects\/[a-z-]+\/(\d+)(?:\/|$)/ },
];

/**
 * Classify a locale-stripped pathname for previewing.
 *
 * Always returns a match: routes with no recognisable record fall back to the
 * generic `app` card, so a shared link never degrades to the sign-in page's
 * metadata.
 */
export function matchPreviewRoute(path: string): PreviewRouteMatch {
  for (const { entity, pattern } of PREVIEW_ROUTE_PATTERNS) {
    const match = path.match(pattern);
    if (!match) continue;

    const id = Number(match[1]);
    // Guard against ids that overflow into imprecise territory before they
    // reach a `where: { id }` lookup.
    if (!Number.isSafeInteger(id) || id <= 0) return { entity, id: null };
    return { entity, id };
  }
  return { entity: "app", id: null };
}

/**
 * User-agent substrings for clients that fetch a URL solely to render a preview
 * card. Matched case-insensitively against the raw UA.
 *
 * These clients never carry cookies, so treating them as ordinary anonymous
 * visitors (redirect to sign-in) is what produced the generic card. Anything
 * not on this list keeps the existing redirect behaviour untouched.
 */
const PREVIEW_BOT_TOKENS: readonly string[] = [
  // Chat and messaging
  "slackbot",
  "discordbot",
  "telegrambot",
  "whatsapp",
  "skypeuripreview",
  "microsoftpreview",
  "snapchat",
  "line-podcast",
  // Social
  "twitterbot",
  "facebookexternalhit",
  "facebot",
  "linkedinbot",
  "pinterest",
  "redditbot",
  "tumblr",
  "flipboard",
  "vkshare",
  "mastodon",
  "cardyb", // Bluesky
  // Search and general crawlers that render cards
  "googlebot",
  "google-inspectiontool",
  "bingbot",
  "applebot",
  "duckduckbot",
  "yandex",
  "petalbot",
  // Preview / embed services
  "embedly",
  "iframely",
  "opengraph",
  "quora link preview",
  "outbrain",
  "nuzzel",
  "bitlybot",
  "xing-contenttabreceiver",
  "w3c_validator",
  "notionbot",
];

/**
 * Generic fallback for the long tail of preview fetchers that don't announce
 * themselves by name. Word-anchored so it can't fire on a substring inside an
 * ordinary browser UA.
 *
 * A false positive is not harmful: `/api/link-preview` bounces anything with a
 * real browser to the sign-in page, which is exactly where an anonymous visitor
 * was headed anyway.
 */
const GENERIC_BOT_PATTERN =
  /\b(?:bot|crawler|spider|unfurl)\b|\bbot\/|link ?preview/i;

/** True when the request is a preview fetcher rather than a person's browser. */
export function isLinkPreviewBot(
  userAgent: string | null | undefined
): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  if (PREVIEW_BOT_TOKENS.some((token) => ua.includes(token))) return true;
  return GENERIC_BOT_PATTERN.test(ua);
}
