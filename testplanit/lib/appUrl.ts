import { BASE_PATH, stripBasePath, withBasePath } from "./basePath";

/**
 * The browser-facing base of this install, prefix included and without a
 * trailing slash: "https://example.com" at the root,
 * "https://example.com/testplanit" under a subpath. Every absolute link the
 * server builds (emails, webhooks, SAML and OAuth redirects, SCIM locations,
 * metadata) starts from this.
 *
 * Order:
 * 1. APP_URL, when set.
 * 2. NEXTAUTH_URL. Under a subpath NextAuth v4 needs that variable to name
 *    its own route in full (…/testplanit/api/auth), so a trailing /api/auth
 *    is removed here; at the root it is the origin as today.
 * 3. http://localhost:3000 plus the prefix.
 *
 * Server-only: the env is read at call time, so tests can override it.
 */
export function getAppUrl(
  env: Record<string, string | undefined> = process.env
): string {
  const explicit = env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const nextAuthUrl = env.NEXTAUTH_URL?.trim();
  if (nextAuthUrl) {
    return nextAuthUrl.replace(/\/+$/, "").replace(/\/api\/auth$/, "");
  }

  return `http://localhost:3000${BASE_PATH}`;
}

/**
 * Absolute URL for an app path: "/en-US/projects" becomes
 * "https://example.com/testplanit/en-US/projects". The prefix is added exactly
 * once whether or not `path` already carries it, and whether or not the
 * configured base does. Absolute inputs are returned as they are.
 */
export function absoluteAppUrl(
  path: string,
  env: Record<string, string | undefined> = process.env
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) return path;
  const base = getAppUrl(env);
  const rooted = path.startsWith("/") ? path : `/${path}`;
  const relative =
    BASE_PATH && base.endsWith(BASE_PATH)
      ? stripBasePath(rooted)
      : withBasePath(rooted);
  return `${base}${relative}`;
}
