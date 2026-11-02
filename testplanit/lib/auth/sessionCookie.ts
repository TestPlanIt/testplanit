import { encode, getToken, type JWT } from "next-auth/jwt";
import type { NextRequest, NextResponse } from "next/server";

// Mirrors NextAuth's defaults: the session cookie lives 30 days, and the
// `__Secure-` name is used exactly when NEXTAUTH_URL is https (getToken
// resolves the name the same way, so reads and writes stay in step).
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function secureCookiesEnabled(): boolean {
  return (
    process.env.NEXTAUTH_URL?.startsWith("https://") ?? !!process.env.VERCEL
  );
}

export function sessionCookieName(): string {
  return secureCookiesEnabled()
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
}

/**
 * Re-encode the caller's own NextAuth JWT with `patch` applied and attach it
 * to `response` as a fresh session cookie.
 *
 * Used by the password-change routes: they stamp `passwordChangedAt`, which
 * the session callback's SECURITY-03 guard compares against the JWT claim to
 * sign out every session issued before the change. The session that made the
 * change is meant to survive, so it gets a cookie carrying the new timestamp
 * on the same response — no client-side `update()` round trip, and no window
 * in which the caller's next request is rejected.
 *
 * Returns false (and leaves `response` untouched) when the request carries no
 * session cookie, e.g. API-token callers, or when NEXTAUTH_SECRET is unset.
 */
export async function reissueSessionCookie(
  request: NextRequest,
  response: NextResponse,
  patch: Partial<JWT>
): Promise<boolean> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return false;

  const token = await getToken({ req: request, secret });
  if (!token) return false;

  const sessionToken = await encode({
    token: { ...token, ...patch },
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  response.cookies.set(sessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return true;
}
