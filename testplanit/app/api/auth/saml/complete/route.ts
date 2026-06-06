import { encode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { consumeTempSessionToken, getAppBaseUrl } from "~/lib/auth-security";
import { db } from "~/server/db";

// SAML completion handler - creates NextAuth session
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get("token");
    const callbackUrl = searchParams.get("callbackUrl") || "/";

    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    // Verify and consume the one-time token (single-use via Valkey when
    // present, so the token in the redirect URL can't be replayed).
    const tokenData = await consumeTempSessionToken(token);
    if (!tokenData) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Get user from database
    const user = await db.user.findUnique({
      where: { id: tokenData.userId },
      select: {
        id: true,
        email: true,
        name: true,
        access: true,
        isApi: true,
        passwordChangedAt: true,
        mustChangePassword: true,
        twoFactorEnabled: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Mirror NextAuth's force-2FA-for-SSO gate (the jwt callback in server/auth):
    // this flow mints the session directly, so without stamping the same flags
    // here a SAML login would bypass an enforced 2FA policy.
    const twoFactorClaims: {
      twoFactorRequired?: boolean;
      twoFactorVerified?: boolean;
      twoFactorSetupRequired?: boolean;
    } = {};
    const registrationSettings = await db.registrationSettings.findFirst({
      select: { force2FAAllLogins: true },
    });
    if (registrationSettings?.force2FAAllLogins) {
      if (user.twoFactorEnabled) {
        twoFactorClaims.twoFactorRequired = true;
        twoFactorClaims.twoFactorVerified = false;
      } else {
        twoFactorClaims.twoFactorSetupRequired = true;
      }
    }

    // Create NextAuth JWT session token. Seed the same fields the NextAuth `jwt`
    // callback sets at sign-in so middleware (which only decodes the token, and
    // never runs the callback) sees the user's access on the very first request.
    const sessionToken = await encode({
      token: {
        sub: user.id,
        email: user.email,
        name: user.name,
        provider: tokenData.provider,
        access: user.access,
        isApi: user.isApi,
        passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
        mustChangePassword: user.mustChangePassword ?? false,
        ...twoFactorClaims,
      },
      secret: process.env.NEXTAUTH_SECRET || "development-secret",
    });

    // Set the session cookie
    const cookieStore = await cookies();
    cookieStore.set("next-auth.session-token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    // For production, use secure cookie name
    if (process.env.NODE_ENV === "production") {
      cookieStore.set("__Secure-next-auth.session-token", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
    }

    // Redirect to callback URL
    return NextResponse.redirect(new URL(callbackUrl, getAppBaseUrl(request)));
  } catch (error) {
    console.error("SAML completion error:", error);
    return NextResponse.json(
      { error: "Failed to complete SAML authentication" },
      { status: 500 }
    );
  }
}
