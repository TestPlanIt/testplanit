import { NextRequest, NextResponse } from "next/server";
import { extractAuditContextFromRequest } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { checkRateLimit } from "~/lib/auth-security";
import { withRequestRouting } from "~/lib/db/requestRouting";
import {
  buildPasskeyAuthenticationOptions,
  getPasskeyAvailability,
  isPasskeyOrigin,
} from "~/lib/passkey";
import { db } from "~/server/db";

/**
 * POST /api/auth/passkey/authenticate/options
 *
 * Start a passkey sign-in: hand the browser a challenge. The request names no
 * account and nothing is stored, so the answer is the same for everyone; the
 * sign-in itself completes through the "passkey" NextAuth provider.
 */
const handlePOST = withAuditContext(async (req: NextRequest) => {
  const availability = await getPasskeyAvailability(db);
  if (!availability.available) {
    return NextResponse.json({ enabled: false });
  }
  if (!isPasskeyOrigin(req.headers.get("origin"))) {
    return NextResponse.json({ enabled: false, reason: "address_mismatch" });
  }

  const ip = extractAuditContextFromRequest(req).ipAddress ?? "unknown";
  const allowed = await checkRateLimit(`passkey:options:ip:${ip}`, {
    windowMs: 60_000,
    maxAttempts: 20,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment and try again." },
      { status: 429 }
    );
  }

  const { options, challengeToken } = await buildPasskeyAuthenticationOptions();
  return NextResponse.json({ enabled: true, options, challengeToken });
});

export const POST = withRequestRouting(handlePOST);
