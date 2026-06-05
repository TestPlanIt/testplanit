import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  createSamlRelayState,
  getAppBaseUrl,
  sanitizeCallbackUrl,
} from "~/lib/auth-security";
import { db } from "~/server/db";
import { createSAMLClient } from "~/server/saml-provider";

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

    // Fetch SAML configuration from database. The UI passes the SsoProvider id,
    // which is the unique foreign key on SamlConfiguration (not its own id).
    const samlConfig = await db.samlConfiguration.findUnique({
      where: { providerId },
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

    // Carry the provider and post-login destination in RelayState. The IdP
    // echoes this back on its cross-site POST to the ACS, where same-site
    // cookies are not sent — so a cookie cannot be used to recover them.
    const relayState = await createSamlRelayState({ providerId, callbackUrl });

    // Generate SAML auth request
    const authUrl = await samlClient.getAuthorizeUrlAsync(
      relayState,
      new URL(getAppBaseUrl(request)).host,
      {}
    );

    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error("SAML login error:", error);
    return NextResponse.json(
      { error: "Failed to initiate SAML login" },
      { status: 500 }
    );
  }
}
