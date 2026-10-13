/**
 * Whether a tracker-provided URL is safe to render as a link.
 *
 * `externalUrl` on an issue, requirement or milestone comes from the remote
 * tracker, and several sync paths write it through the raw db client, which
 * bypasses the schema's `@url` validation. An unchecked href therefore lets a
 * tracker-side value become a `javascript:` (or `data:`) link in this app, so
 * every surface that renders one gates on this first.
 *
 * Pair a true result with `rel="noopener noreferrer"` on the anchor — the
 * scheme check says the destination is a web page, not that it is friendly.
 */
const SAFE_EXTERNAL_URL_RE = /^https?:\/\//i;

export function isSafeExternalUrl(url: unknown): url is string {
  return typeof url === "string" && SAFE_EXTERNAL_URL_RE.test(url);
}

/** The URL when it is safe to link to, otherwise `null`. */
export function safeExternalUrl(url: unknown): string | null {
  return isSafeExternalUrl(url) ? url : null;
}
