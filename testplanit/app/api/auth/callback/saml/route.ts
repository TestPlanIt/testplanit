import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  consumeSamlRelayState,
  createTempSessionToken,
  getAppBaseUrl,
  getSecurityHeaders,
  sanitizeCallbackUrl,
  validateSAMLTimestamp,
} from "~/lib/auth-security";
import { NotificationService } from "~/lib/services/notificationService";
import { isEmailDomainAllowed } from "~/lib/utils/email-domain-validation";
import { db } from "~/server/db";
import { createSAMLClient, validateSAMLResponse } from "~/server/saml-provider";

/**
 * SAML Assertion Consumer Service (ACS).
 *
 * The IdP POSTs the SAMLResponse here. This path matches the ACS URL embedded
 * in the AuthnRequest (createSAMLClient) and shown in the admin UI. It is a
 * static route, so it takes precedence over the NextAuth [...nextauth]
 * catch-all for this exact path.
 */
export async function POST(request: NextRequest) {
  try {
    const clientIp =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";

    // Rate limiting check
    if (
      !checkRateLimit(`saml-callback:${clientIp}`, {
        windowMs: 60000,
        maxAttempts: 20,
      })
    ) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: getSecurityHeaders() }
      );
    }

    // Get SAML response from body
    const formData = await request.formData();
    const samlResponse = formData.get("SAMLResponse");
    const relayState = formData.get("RelayState");

    if (!samlResponse) {
      return NextResponse.json(
        { error: "SAML response is required" },
        { status: 400 }
      );
    }

    // Recover the provider and destination from RelayState (the IdP echoes it
    // back here; same-site cookies are not sent on this cross-site POST). The
    // token is single-use and short-lived, which is what guards this endpoint.
    const relay = await consumeSamlRelayState(
      typeof relayState === "string" ? relayState : null
    );

    if (!relay) {
      return NextResponse.json(
        { error: "Invalid or expired SAML request" },
        { status: 400 }
      );
    }

    const providerId = relay.providerId;
    const callbackUrl = sanitizeCallbackUrl(relay.callbackUrl);

    // Fetch SAML configuration. RelayState carries the SsoProvider id, which is
    // the unique foreign key on SamlConfiguration (not its own id).
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

    // Create SAML client and validate response
    const samlClient = await createSAMLClient({
      name: samlConfig.provider.name,
      entryPoint: samlConfig.entryPoint,
      cert: samlConfig.cert,
      issuer: samlConfig.issuer,
    });

    const profile = await validateSAMLResponse(samlClient, {
      SAMLResponse: samlResponse,
    });

    // Validate SAML response timestamps if available
    if (profile.notBefore || profile.notOnOrAfter) {
      if (
        !validateSAMLTimestamp(
          profile.notBefore as string | undefined,
          profile.notOnOrAfter as string | undefined
        )
      ) {
        return NextResponse.json(
          { error: "SAML response has expired or is not yet valid" },
          { status: 400 }
        );
      }
    }

    // Extract user attributes based on mapping
    const attributeMapping = samlConfig.attributeMapping as any;
    const email = profile[attributeMapping.email || "email"] as string;
    const externalId = (profile[attributeMapping.id || "nameID"] ||
      profile.nameID) as string;

    // Extract name fields
    const firstName = profile[attributeMapping.firstName || "givenName"] as
      | string
      | undefined;
    const lastName = profile[attributeMapping.lastName || "surname"] as
      | string
      | undefined;
    const displayName = profile[attributeMapping.name || "name"] as
      | string
      | undefined;

    // Construct full name from available fields
    let name = displayName;
    if (!name && (firstName || lastName)) {
      name = [firstName, lastName].filter(Boolean).join(" ");
    }
    if (!name) {
      name = email.split("@")[0];
    }

    if (!email) {
      return NextResponse.json(
        { error: "Email not found in SAML response" },
        { status: 400 }
      );
    }

    // Check if user exists
    let user = await db.user.findUnique({
      where: { email },
    });

    if (!user && samlConfig.autoProvisionUsers) {
      // Check domain restrictions for new users
      const isDomainAllowed = await isEmailDomainAllowed(email);
      if (!isDomainAllowed) {
        return NextResponse.json(
          {
            error:
              "Registration is restricted to approved email domains. Please contact your administrator.",
          },
          { status: 403 }
        );
      }

      // Get the default role from database
      const defaultRole =
        (await db.roles.findFirst({
          where: { isDefault: true, isDeleted: false },
        })) ??
        (await db.roles.findFirst({
          where: { name: "user", isDeleted: false },
        }));

      if (!defaultRole) {
        return NextResponse.json(
          {
            error:
              "No default role found. Please ensure a default role exists.",
          },
          { status: 500 }
        );
      }

      // Auto-provision new user
      user = await db.user.create({
        data: {
          email,
          name,
          emailVerified: new Date(),
          password: randomUUID(), // Random password for SSO users
          authMethod: "SSO",
          externalId: externalId || null,
          access: samlConfig.defaultAccess || "USER",
          roleId: defaultRole.id,
          userPreferences: {
            create: {
              theme: "Purple",
              itemsPerPage: "P10",
              locale: "en_US",
              dateFormat: "MM_DD_YYYY_DASH",
              timeFormat: "HH_MM_A",
              timezone: "Etc/UTC",
              notificationMode: "USE_GLOBAL",
              emailNotifications: true,
              inAppNotifications: true,
            },
          },
        },
      });

      // Notify system administrators about the new user registration via SSO
      try {
        await NotificationService.createUserRegistrationNotification(
          name,
          email,
          user.id,
          "sso"
        );
      } catch (error) {
        console.error(
          "Failed to send SSO user registration notifications:",
          error
        );
        // Don't fail the SSO process if notifications fail
      }
    } else if (!user) {
      // User doesn't exist and auto-provisioning is disabled
      return NextResponse.json(
        { error: "User not found. Please contact your administrator." },
        { status: 403 }
      );
    } else {
      // Update existing user with latest SAML attributes if changed
      const updates: any = {};
      if (name && user.name !== name) updates.name = name;
      if (externalId && user.externalId !== externalId)
        updates.externalId = externalId;

      // Update authMethod for existing users
      if (user.authMethod === "INTERNAL") {
        updates.authMethod = "BOTH";
      }

      if (Object.keys(updates).length > 0) {
        await db.user.update({
          where: { id: user.id },
          data: updates,
        });
      }
    }

    // Create or update OAuth account
    await db.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: `saml-${samlConfig.provider.name}`,
          providerAccountId: externalId as string,
        },
      },
      update: {
        userId: user.id,
      },
      create: {
        userId: user.id,
        type: "oauth",
        provider: `saml-${samlConfig.provider.name}`,
        providerAccountId: externalId as string,
      },
    });

    // Create a temporary session token for secure user info transfer
    const tempToken = createTempSessionToken({
      userId: user.id,
      provider: `saml-${samlConfig.provider.name}`,
      email: user.email,
    });

    // Hand off to the completion route, which verifies the token and mints the
    // NextAuth session cookie before redirecting to the final destination.
    const response = NextResponse.redirect(
      new URL(
        `/api/auth/saml/complete?token=${tempToken}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
        getAppBaseUrl(request)
      )
    );

    // Set security headers
    const securityHeaders = getSecurityHeaders();
    Object.entries(securityHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error) {
    console.error("SAML callback error:", error);
    return NextResponse.json(
      { error: "Failed to process SAML response" },
      { status: 500 }
    );
  }
}
