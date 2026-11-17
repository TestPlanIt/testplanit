import type { CookiesOptions } from "next-auth";
import { BASE_PATH, COOKIE_PATH } from "~/lib/basePath";

/**
 * next-auth's cookie settings for this install.
 *
 * At the root this returns undefined so next-auth keeps its own defaults,
 * byte for byte. Under a path prefix the host is shared with other
 * applications, possibly other next-auth apps using the same cookie names,
 * so every cookie is scoped to the prefix. The names stay the defaults
 * (getToken in the proxy and the hand-written session writes resolve them
 * the same way), with one exception: the `__Host-` CSRF cookie that
 * next-auth uses over https is only valid with path "/", so under a prefix it
 * becomes a `__Secure-` cookie instead.
 */
export function authCookies(
  useSecureCookies: boolean,
  basePath = BASE_PATH
): Partial<CookiesOptions> | undefined {
  if (!basePath) return undefined;
  const prefix = useSecureCookies ? "__Secure-" : "";
  const path = basePath;
  const base = { sameSite: "lax" as const, path, secure: useSecureCookies };
  return {
    sessionToken: {
      name: `${prefix}next-auth.session-token`,
      options: { ...base, httpOnly: true },
    },
    callbackUrl: {
      name: `${prefix}next-auth.callback-url`,
      options: { ...base, httpOnly: true },
    },
    csrfToken: {
      name: `${prefix}next-auth.csrf-token`,
      options: { ...base, httpOnly: true },
    },
    pkceCodeVerifier: {
      name: `${prefix}next-auth.pkce.code_verifier`,
      options: { ...base, httpOnly: true, maxAge: 60 * 15 },
    },
    state: {
      name: `${prefix}next-auth.state`,
      options: { ...base, httpOnly: true, maxAge: 60 * 15 },
    },
    nonce: {
      name: `${prefix}next-auth.nonce`,
      options: { ...base, httpOnly: true },
    },
  };
}

/** True exactly when next-auth would use its `__Secure-` cookie names. */
export function secureAuthCookiesEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.NEXTAUTH_URL?.startsWith("https://") ?? !!env.VERCEL;
}

/**
 * Serializes a browser-side cookie write with the install's path, for the
 * few places that set a cookie from the client (the locale preference).
 */
export function clientCookie(
  name: string,
  value: string,
  attributes: string[] = []
): string {
  return [`${name}=${value}`, `path=${COOKIE_PATH}`, ...attributes].join(";");
}
