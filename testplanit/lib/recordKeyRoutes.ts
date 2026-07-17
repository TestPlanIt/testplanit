import { parseRecordId } from "./recordKey";

/**
 * Symmetric URL lookup for cosmetic project-prefixed record keys.
 *
 * The middleware (`proxy.ts`) uses this to redirect a detail-route URL whose id
 * segment is a prefixed key (e.g. `PROJECT-TC-1234`) to its canonical numeric
 * form (`1234`) before any page renders. The number is already inside the key,
 * so this is a pure string transform — no DB lookup.
 *
 * Only the routed record types are handled here (test case, run, session,
 * milestone, tag, data set). Each pattern is anchored to a specific route shape
 * so opaque string/slug ids elsewhere (e.g. SSO `providerId`, cuid dataset
 * *rows*) are never touched. Patterns run against the locale-stripped pathname.
 */
const RECORD_KEY_ROUTE_PATTERNS: readonly RegExp[] = [
  // Global stubs
  /^(?<head>\/case\/)(?<key>[^/]+)(?<rest>\/.*)?$/,
  /^(?<head>\/milestone\/)(?<key>[^/]+)(?<rest>\/.*)?$/,
  /^(?<head>\/tags\/)(?<key>[^/]+)(?<rest>\/.*)?$/,
  // Project-scoped detail routes (may carry a trailing /{version} etc. in rest)
  /^(?<head>\/projects\/repository\/\d+\/)(?<key>[^/]+)(?<rest>\/.*)?$/,
  /^(?<head>\/projects\/runs\/\d+\/)(?<key>[^/]+)(?<rest>\/.*)?$/,
  /^(?<head>\/projects\/sessions\/\d+\/)(?<key>[^/]+)(?<rest>\/.*)?$/,
  /^(?<head>\/projects\/milestones\/\d+\/)(?<key>[^/]+)(?<rest>\/.*)?$/,
  /^(?<head>\/projects\/tags\/\d+\/)(?<key>[^/]+)(?<rest>\/.*)?$/,
  /^(?<head>\/projects\/settings\/\d+\/datasets\/)(?<key>[^/]+)(?<rest>\/.*)?$/,
];

/**
 * If `path` (a locale-stripped pathname, no query/hash) is a record-detail
 * route whose id segment is a cosmetic prefixed key, return the same path with
 * that segment collapsed to the canonical numeric id. Returns `null` when:
 *   - the path is not one of the handled routes,
 *   - the id segment is already a bare number (nothing to canonicalize), or
 *   - the segment can't be parsed to an id (leave it for the page to 404).
 */
export function normalizeRecordKeyPath(path: string): string | null {
  for (const pattern of RECORD_KEY_ROUTE_PATTERNS) {
    const match = path.match(pattern);
    if (!match?.groups) continue;

    const { head, key, rest } = match.groups;
    // Already canonical (bare digits) — no redirect needed.
    if (/^\d+$/.test(key)) return null;

    const id = parseRecordId(key);
    if (id == null) return null; // unparseable → let the route render its 404

    return `${head}${id}${rest ?? ""}`;
  }
  return null;
}
