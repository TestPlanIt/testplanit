/**
 * Path-prefix support for installs served under a subpath of a shared host
 * (https://example.com/testplanit instead of https://testplanit.example.com).
 *
 * Next.js prefixes only what it routes itself (<Link>, router.push, /_next
 * assets, redirect()). Everything the app builds by hand from a root-relative
 * string — fetch("/api/..."), window.location.href = "/...", EventSource URLs,
 * NextResponse.redirect in route handlers — still points at the host root.
 * Those go through the helpers here.
 *
 * BASE_PATH is fixed at build time: next.config.ts validates the BASE_PATH
 * build variable, hands it to Next's `basePath`, and inlines it as
 * NEXT_PUBLIC_BASE_PATH so client and server bundles agree. It is "" at the
 * root, so every helper is a no-op for the default install.
 *
 * Safe to import from client components, server components, route handlers
 * and the proxy.
 */

/** The inlined prefix: "" at the root, "/testplanit" under a subpath. */
export const BASE_PATH: string = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * Path attribute for every cookie the app sets. Under a subpath the host is
 * shared with other applications, so cookies are scoped to the prefix and
 * cannot collide with (or be read by) a neighbour that uses the same cookie
 * names. "/" at the root, as before. Deliberately without a trailing slash:
 * a cookie path "/testplanit" matches "/testplanit" and "/testplanit/…",
 * while "/testplanit/" would miss the bare prefix URL.
 */
export const COOKIE_PATH: string = BASE_PATH || "/";

/**
 * Validates a raw BASE_PATH value and returns its canonical form ("" for the
 * root). Throws on anything Next would mis-handle: a missing leading slash, a
 * trailing slash, empty segments, or a query/fragment.
 */
export function normalizeBasePath(raw: string | undefined | null): string {
  const value = (raw ?? "").trim();
  if (value === "" || value === "/") return "";
  if (!value.startsWith("/")) {
    throw new Error(
      `BASE_PATH must start with "/" (got ${JSON.stringify(value)})`
    );
  }
  if (value.endsWith("/")) {
    throw new Error(
      `BASE_PATH must not end with "/" (got ${JSON.stringify(value)})`
    );
  }
  if (/[?#\s]/.test(value) || value.includes("//")) {
    throw new Error(
      `BASE_PATH must be a plain path like "/testplanit" (got ${JSON.stringify(value)})`
    );
  }
  return value;
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;

/** True for "https://…", "mailto:…", "data:…" and protocol-relative "//host". */
export function isAbsoluteUrl(value: string): boolean {
  return ABSOLUTE_URL.test(value) || value.startsWith("//");
}

/** True when `pathname` is the prefix itself or lives under it. */
export function hasBasePath(pathname: string, basePath = BASE_PATH): boolean {
  if (!basePath) return true;
  return (
    pathname === basePath ||
    pathname.startsWith(`${basePath}/`) ||
    pathname.startsWith(`${basePath}?`) ||
    pathname.startsWith(`${basePath}#`)
  );
}

/**
 * Prefixes a root-relative path exactly once. Absolute URLs, protocol-relative
 * URLs, already-prefixed paths and non-rooted strings ("api/x", "?page=2")
 * come back untouched.
 */
export function withBasePath(path: string, basePath = BASE_PATH): string {
  if (!basePath) return path;
  if (!path.startsWith("/") || isAbsoluteUrl(path)) return path;
  if (hasBasePath(path, basePath)) return path;
  return `${basePath}${path}`;
}

/**
 * Removes the prefix from a raw request pathname, for server code that reads
 * the URL as the browser sent it. Returns the input unchanged when it is not
 * under the prefix.
 */
export function stripBasePath(pathname: string, basePath = BASE_PATH): string {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length);
  }
  return pathname;
}

/**
 * `fetch` for the app's own API: a root-relative `input` is prefixed, anything
 * else (absolute URL, Request object) is passed through.
 */
export function apiFetch(
  input: string | URL | Request,
  ...rest: [init?: RequestInit]
): Promise<Response> {
  const target = typeof input === "string" ? withBasePath(input) : input;
  // Forwards exactly the arguments it was given (one or two, even an explicit
  // undefined): tests assert on fetch's exact argument list.
  return fetch(target, ...rest);
}

/**
 * Wraps a global `fetch` so that root-relative string inputs are prefixed.
 * Installed once in the browser by instrumentation-client.ts. It is the
 * safety net under the explicit apiFetch migration: generated ZenStack hooks,
 * third-party code and any call the lint rule did not catch all go through
 * the same global. A no-op at the root, so the default install is untouched.
 *
 * Only strings are rewritten. A URL instance is always absolute, and a Request
 * has already resolved its URL against the document, so neither can be
 * prefixed safely after the fact.
 */
export function installBasePathFetch(
  target: { fetch: typeof fetch },
  basePath = BASE_PATH
): void {
  if (!basePath) return;
  const original = target.fetch;
  if ((original as { __basePath?: string }).__basePath === basePath) return;
  const wrapped: typeof fetch = function (this: unknown, input, init) {
    const resolved =
      typeof input === "string" ? withBasePath(input, basePath) : input;
    return original.call(this, resolved, init);
  };
  (wrapped as { __basePath?: string }).__basePath = basePath;
  target.fetch = wrapped;
}
