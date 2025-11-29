import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { createSAMLClient, validateSAMLResponse } from "~/server/saml-provider";
import {
  verifyState,
  sanitizeCallbackUrl,
  createTempSessionToken,
  checkRateLimit,
  validateSAMLTimestamp,
  getSecurityHeaders,
} from "~/lib/auth-security";
import { NotificationService } from "~/lib/services/notificationService";
import { randomUUID } from "crypto";
import { isEmailDomainAllowed } from "~/lib/utils/email-domain-validation";

// SAML callback handler
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

    // Get provider and state from cookies
    const providerId = request.cookies.get("saml-provider")?.value;
    const storedState = request.cookies.get("saml-state")?.value;
    const callbackUrl = sanitizeCallbackUrl(
      request.cookies.get("saml-callback-url")?.value
    );

    if (!providerId) {
      return NextResponse.json(
        { error: "Provider information not found" },
        { status: 400 }
      );
    }

    // Verify state if relay state is provided
    if (relayState && !verifyState(storedState, relayState as string)) {
      return NextResponse.json(
        { error: "Invalid state parameter" },
        { status: 400 }
      );
    }

    // Fetch SAML configuration
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
          { error: "Registration is restricted to approved email domains. Please contact your administrator." },
          { status: 403 }
        );
      }

      // Get the default role from database
      const defaultRole = await db.roles.findFirst({
        where: { isDefault: true, isDeleted: false },
      });

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
          roleId: defaultRole?.id || 1,
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
        console.error("Failed to send SSO user registration notifications:", error);
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

    // Create a session for the user by redirecting to NextAuth callback
    const response = NextResponse.redirect(
      new URL(
        `/api/auth/callback/saml?token=${tempToken}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
        request.url
      )
    );

    // Clean up cookies
    response.cookies.delete("saml-state");
    response.cookies.delete("saml-provider");
    response.cookies.delete("saml-callback-url");

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
