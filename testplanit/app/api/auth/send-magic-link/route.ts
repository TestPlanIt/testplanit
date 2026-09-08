import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAppBaseUrl } from "~/lib/auth-security";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { auditAuthEvent } from "~/lib/services/auditLog";

/**
 * POST /api/auth/send-magic-link
 *
 * Sends a magic link email to the specified email address.
 * Used by the provisioning worker to send the initial magic link to new trial admins.
 *
 * Body:
 * - email: The email address to send the magic link to
 * - callbackUrl: Optional callback URL (defaults to home page)
 */
export const POST = withAuditContext(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { email, callbackUrl = "/" } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Check if user exists and is active. Pull `userPreferences.locale`
    // so the email is rendered in the recipient's language; falls back
    // to en_US. Emails match case-insensitively; an exact-cased row wins
    // when case-variant duplicates exist.
    const select = {
      id: true,
      isActive: true,
      userPreferences: { select: { locale: true } },
    } as const;
    const user =
      (await baseDb.user.findUnique({ where: { email }, select })) ??
      (await baseDb.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select,
      }));

    if (!user || !user.isActive) {
      // Still return success to prevent enumeration
      return NextResponse.json({
        success: true,
        message: "If a user with that email exists, a magic link has been sent",
      });
    }

    // Generate a verification token
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Hash the token before storing - NextAuth uses sha256(token + secret)
    // When user clicks the link, NextAuth hashes the URL token and looks up the hash
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      throw new Error("NEXTAUTH_SECRET is not configured");
    }
    const hashedToken = crypto
      .createHash("sha256")
      .update(`${token}${secret}`)
      .digest("hex");

    // Store the hashed token in the database
    await baseDb.verificationToken.create({
      data: {
        identifier: email,
        token: hashedToken,
        expires,
      },
    });

    // Build the magic link URL
    const baseUrl = getAppBaseUrl(req);

    // Ensure callbackUrl has a trailing slash for proper routing
    let finalCallbackUrl = callbackUrl.startsWith("http")
      ? callbackUrl
      : baseUrl + callbackUrl;
    if (!finalCallbackUrl.endsWith("/")) {
      finalCallbackUrl += "/";
    }

    const url = `${baseUrl}/api/auth/callback/email?callbackUrl=${encodeURIComponent(finalCallbackUrl)}&token=${token}&email=${encodeURIComponent(email)}`;

    // Render and send the localized magic-link email via the shared helper.
    const { sendMagicLinkEmail } = await import("~/lib/email/magicLink");
    await sendMagicLinkEmail({
      to: email,
      url,
      locale: user.userPreferences?.locale ?? "en_US",
    });

    // Audit magic-link request (the generated token is NOT logged — only
    // the requested email and auth method).
    await auditAuthEvent("MAGIC_LINK_REQUESTED", user.id, email, {
      requestedEmail: email,
      authMethod: "magic-link",
    });

    return NextResponse.json({
      success: true,
      message: "Magic link sent successfully",
    });
  } catch (error: any) {
    console.error("Failed to send magic link:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    return NextResponse.json(
      {
        error: "Failed to send magic link",
        details: error.message,
      },
      { status: 500 }
    );
  }
});
