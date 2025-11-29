import { NextRequest, NextResponse } from "next/server";
import { createSAMLClient } from "~/server/saml-provider";
import { db } from "~/server/db";
import {
  generateSecureState,
  sanitizeCallbackUrl,
  getSecureCookieOptions,
  checkRateLimit,
} from "~/lib/auth-security";

// SAML login initiation
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const providerId = searchParams.get("provider");
    const callbackUrl = sanitizeCallbackUrl(searchParams.get("callbackUrl"));
    const clientIp =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";

    // Rate limiting check
    if (
      !checkRateLimit(`saml-init:${clientIp}`, {
        windowMs: 60000,
        maxAttempts: 10,
      })
    ) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    if (!providerId) {
      return NextResponse.json(
        { error: "Provider ID is required" },
        { status: 400 }
      );
    }

    // Fetch SAML configuration from database
    const samlConfig = await db.samlConfiguration.findUnique({
      where: { id: providerId },
      include: { provider: true },
    });

    if (!samlConfig || !samlConfig.provider.enabled) {
      return NextResponse.json(
        { error: "SAML provider not found or disabled" },
        { status: 404 }
      );
    }

    // Create SAML client
    const samlClient = await createSAMLClient({
      name: samlConfig.provider.name,
      entryPoint: samlConfig.entryPoint,
      cert: samlConfig.cert,
      issuer: samlConfig.issuer,
    });

    // Generate SAML auth request
    const authUrl = await samlClient.getAuthorizeUrlAsync(
      "",
      request.headers.get("host") || "",
      {}
    );

    // Generate secure state parameter for CSRF protection
    const state = generateSecureState();
    const response = NextResponse.redirect(authUrl);
    const cookieOptions = getSecureCookieOptions();

    // Set cookies with secure options
    response.cookies.set("saml-state", state, {
      ...cookieOptions,
      maxAge: 60 * 15, // 15 minutes
    });

    response.cookies.set("saml-provider", providerId, {
      ...cookieOptions,
      maxAge: 60 * 15, // 15 minutes
    });

    response.cookies.set("saml-callback-url", callbackUrl, {
      ...cookieOptions,
      maxAge: 60 * 15, // 15 minutes
    });

    return response;
  } catch (error) {
    console.error("SAML login error:", error);
    return NextResponse.json(
      { error: "Failed to initiate SAML login" },
      { status: 500 }
    );
  }
}
