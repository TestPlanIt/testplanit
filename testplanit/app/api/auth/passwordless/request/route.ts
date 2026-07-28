import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { extractAuditContextFromRequest } from "~/lib/auditContext";
import {
  checkRateLimit,
  getAppBaseUrl,
  sanitizeCallbackUrl,
} from "~/lib/auth-security";
import {
  createPendingAuth,
  encodeVerifierCookie,
  getVerifierCookieName,
  getVerifierCookieOptions,
  isPasswordlessDeviceBoundEnabled,
  validateNextAuthCsrf,
} from "~/lib/passwordless";
import { auditAuthEvent } from "~/lib/services/auditLog";
import { db } from "~/server/db";

const RequestSchema = z.object({
  email: z.string().email().max(320),
  callbackUrl: z.string().max(2000).optional(),
  csrfToken: z.string().min(1),
});

/**
 * POST /api/auth/passwordless/request
 *
 * Start a device-bound passwordless sign-in: create a PendingAuth row, bind
 * the requesting browser with an HttpOnly verifier cookie, and email the
 * sign-in link + relay code.
 *
 * Anti-enumeration: the response (shape, status, and timing) is identical for
 * known and unknown emails. A pending row is created either way; the email is
 * dispatched fire-and-forget only for real, active accounts.
 */
export const POST = withAuditContext(async (req: NextRequest) => {
  if (!isPasswordlessDeviceBoundEnabled()) {
    // Client falls back to the stock EmailProvider flow.
    return NextResponse.json({ enabled: false });
  }

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Reuse NextAuth's double-submit CSRF token for this out-of-band POST.
  if (!validateNextAuthCsrf(req.headers.get("cookie"), body.csrfToken)) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  // Trimmed, then matched case-insensitively — the same lookup behavior as
  // the stock EmailProvider flow and /api/auth/send-magic-link.
  const email = body.email.trim();
  const auditCtx = extractAuditContextFromRequest(req);
  const ip = auditCtx.ipAddress ?? "unknown";

  // Throttle before any account lookup so limits apply uniformly to real and
  // unknown emails (no enumeration signal via 429s).
  const ipAllowed = checkRateLimit(`passwordless:request:ip:${ip}`, {
    windowMs: 60_000,
    maxAttempts: 10,
  });
  // Case-folded key so case variants can't sidestep the per-email limit.
  const emailAllowed = checkRateLimit(
    `passwordless:request:email:${email.toLowerCase()}`,
    {
      windowMs: 60_000,
      maxAttempts: 3,
    }
  );
  if (!ipAllowed || !emailAllowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  const callbackUrl = sanitizeCallbackUrl(body.callbackUrl);

  const pending = await createPendingAuth(db, {
    email,
    callbackUrl,
    requestIp: auditCtx.ipAddress ?? null,
    requestUserAgent: auditCtx.userAgent ?? null,
  });

  // Look up the account and dispatch the email without awaiting the SMTP
  // round-trip — awaiting it would make real accounts measurably slower to
  // respond than unknown ones.
  void (async () => {
    try {
      const select = {
        id: true,
        isActive: true,
        userPreferences: { select: { locale: true } },
      } as const;
      const user =
        (await db.user.findUnique({ where: { email }, select })) ??
        (await db.user.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select,
        }));
      if (!user || !user.isActive) return;

      const baseUrl = getAppBaseUrl(req);
      const url =
        `${baseUrl}/api/auth/passwordless/callback` +
        `?pid=${encodeURIComponent(pending.id)}` +
        `&token=${encodeURIComponent(pending.linkToken)}` +
        `&code=${encodeURIComponent(pending.code)}`;

      const { sendPasswordlessEmail } = await import("~/lib/email/magicLink");
      await sendPasswordlessEmail({
        to: email,
        url,
        code: pending.code,
        locale: user.userPreferences?.locale ?? "en_US",
      });

      await auditAuthEvent("MAGIC_LINK_REQUESTED", user.id, email, {
        requestedEmail: email,
        authMethod: "passwordless-device-bound",
      });
    } catch (error) {
      // Never propagate: failures here must not alter the response.
      console.error("Passwordless request email error:", error);
    }
  })();

  const res = NextResponse.json({
    enabled: true,
    pendingId: pending.id,
    expiresAt: pending.expiresAt.toISOString(),
  });
  res.cookies.set(
    getVerifierCookieName(),
    encodeVerifierCookie(pending.id, pending.verifier),
    getVerifierCookieOptions()
  );
  return res;
});
