import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl, sanitizeCallbackUrl } from "~/lib/auth-security";
import {
  decodeVerifierCookie,
  inspectPendingAuthLink,
  isPasswordlessDeviceBoundEnabled,
  isValidPasswordlessCodeFormat,
  normalizePasswordlessCode,
  passwordlessSecretMatches,
  getVerifierCookieName,
} from "~/lib/passwordless";
import { db } from "~/server/db";

/**
 * GET /api/auth/passwordless/callback?pid=<id>&token=<linkToken>&code=<code>
 *
 * The emailed sign-in link lands here. This handler is strictly READ-ONLY
 * with respect to the pending sign-in: it never consumes the token and never
 * mints a session, so a mail-security scanner (Safe Links, Mimecast,
 * Proofpoint, Barracuda) prefetching the link N times changes nothing and the
 * human's later click still works.
 *
 * Routing decision only:
 *  - verifier cookie matches this pending row (same browser)  → redirect to
 *    the completion page, which finishes sign-in through the NextAuth
 *    passwordless-complete provider (that POST is where consumption happens).
 *  - no/foreign verifier (other device, incognito, webview, scanner) →
 *    redirect to the code-display page so the user can relay the code into
 *    their original window.
 *  - invalid/expired/used link → friendly expired page. Never a stack trace.
 */
export async function GET(req: NextRequest) {
  // Locale-less page targets: proxy.ts localizes /passwordless/* entry URLs
  // (same treatment as emailed /share links) using the visitor's preferred
  // locale, so this handler doesn't pin one.
  const baseUrl = getAppBaseUrl(req);

  if (!isPasswordlessDeviceBoundEnabled()) {
    // Feature disabled: old links are dead; the expired page offers a fresh
    // request, which will go through whichever flow the deployment runs.
    return NextResponse.redirect(
      `${baseUrl}/passwordless/expired?reason=disabled`
    );
  }

  const pid = req.nextUrl.searchParams.get("pid") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const rawCode = req.nextUrl.searchParams.get("code") ?? "";

  const inspection = await inspectPendingAuthLink(db, pid, token);
  if (inspection.kind !== "valid") {
    return NextResponse.redirect(
      `${baseUrl}/passwordless/expired?reason=${inspection.kind}`
    );
  }

  const cookie = decodeVerifierCookie(
    req.cookies.get(getVerifierCookieName())?.value
  );
  const sameBrowser =
    cookie !== null &&
    cookie.pendingId === inspection.row.id &&
    passwordlessSecretMatches(inspection.row.verifierHash, cookie.verifier);

  if (sameBrowser) {
    const callbackUrl = sanitizeCallbackUrl(inspection.row.callbackUrl);
    const target =
      `${baseUrl}/passwordless/complete` +
      `?pid=${encodeURIComponent(pid)}` +
      `&token=${encodeURIComponent(token)}` +
      `&callbackUrl=${encodeURIComponent(callbackUrl)}`;
    return NextResponse.redirect(target);
  }

  // Cross-device / scanner: show the relay code. The code travels in the
  // emailed URL (it is also printed in the email body); it is only displayed
  // if it hashes to this row, so the page cannot be used to present
  // attacker-chosen content.
  const code = normalizePasswordlessCode(rawCode);
  const codeDisplayable =
    isValidPasswordlessCodeFormat(code) &&
    passwordlessSecretMatches(inspection.row.codeHash, code);
  if (!codeDisplayable) {
    return NextResponse.redirect(
      `${baseUrl}/passwordless/expired?reason=invalid`
    );
  }

  return NextResponse.redirect(
    `${baseUrl}/passwordless/code?code=${encodeURIComponent(code)}`
  );
}
