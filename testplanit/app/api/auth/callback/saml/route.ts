import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  consumeSamlRelayState,
  createTempSessionToken,
  getAppBaseUrl,
  getSecurityHeaders,
  registerSamlAssertion,
  sanitizeCallbackUrl,
  validateSAMLTimestamp,
} from "~/lib/auth-security";
import { NotificationService } from "~/lib/services/notificationService";
import { isEmailDomainAllowed } from "~/lib/utils/email-domain-validation";
import { db } from "~/server/db";
import { createSAMLClient, validateSAMLResponse } from "~/server/saml-provider";

/**
 * Resolve an IdP-initiated SAMLResponse (no RelayState — e.g. an Okta dashboard
 * tile) to the enabled SAML config whose IdP signed it. The stored issuer field
 * is the SP entity id, not a reliable IdP identifier, so we let cryptographic
 * validation pick the config: the assertion only validates against the cert of
 * the IdP that actually issued it. Returns null if none validate it.
 */
async function resolveIdpInitiatedConfig(samlResponse: string) {
  const configs = await db.samlConfiguration.findMany({
    where: { provider: { enabled: true } },
    include: { provider: true },
  });

  for (const samlConfig of configs) {
    try {
      const samlClient = await createSAMLClient({
        name: samlConfig.provider.name,
        entryPoint: samlConfig.entryPoint,
        cert: samlConfig.cert,
        issuer: samlConfig.issuer,
        wantAssertionsSigned: samlConfig.wantAssertionsSigned,
        wantAuthnResponseSigned: samlConfig.wantAuthnResponseSigned,
      });
      const profile = await validateSAMLResponse(samlClient, {
        SAMLResponse: samlResponse,
      });
      return { samlConfig, profile };
    } catch {
      // Not this IdP (or the assertion is invalid) — try the next config.
    }
  }

  return null;
}

type ResolvedSaml = NonNullable<
  Awaited<ReturnType<typeof resolveIdpInitiatedConfig>>
>;

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

    if (!samlResponse || typeof samlResponse !== "string") {
      return NextResponse.json(
        { error: "SAML response is required" },
        { status: 400 }
      );
    }

    // Recover the provider and destination from RelayState. The IdP echoes it
    // back on this cross-site POST (where same-site cookies are not sent); the
    // token is single-use and short-lived, which guards SP-initiated logins.
    const relay = await consumeSamlRelayState(
      typeof relayState === "string" ? relayState : null
    );

    let samlConfig: ResolvedSaml["samlConfig"];
    let profile: ResolvedSaml["profile"];
    let callbackUrl = "/";

    if (relay) {
      // SP-initiated: RelayState carries the SsoProvider id, which is the unique
      // foreign key on SamlConfiguration (not its own id).
      callbackUrl = sanitizeCallbackUrl(relay.callbackUrl);
      const found = await db.samlConfiguration.findUnique({
        where: { providerId: relay.providerId },
        include: { provider: true },
      });

      if (!found || !found.provider.enabled) {
        return NextResponse.json(
          { error: "SAML provider not found or disabled" },
          { status: 404 }
        );
      }

      const samlClient = await createSAMLClient({
        name: found.provider.name,
        entryPoint: found.entryPoint,
        cert: found.cert,
        issuer: found.issuer,
        wantAssertionsSigned: found.wantAssertionsSigned,
        wantAuthnResponseSigned: found.wantAuthnResponseSigned,
      });

      samlConfig = found;
      profile = await validateSAMLResponse(samlClient, {
        SAMLResponse: samlResponse,
      });
    } else {
      // IdP-initiated (no RelayState — e.g. an Okta dashboard tile): pick the
      // enabled config whose cert validates this assertion's signature.
      const resolved = await resolveIdpInitiatedConfig(samlResponse);
      if (!resolved) {
        return NextResponse.json(
          { error: "Invalid or expired SAML request" },
          { status: 400 }
        );
      }
      samlConfig = resolved.samlConfig;
      profile = resolved.profile;
    }

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

    // Reject replayed assertions: a validated assertion is single-use within its
    // validity window. This closes the replay vector opened by accepting
    // IdP-initiated (no-RelayState) POSTs — without it any captured assertion
    // could be re-POSTed until it expires.
    const notOnOrAfterMs = profile.notOnOrAfter
      ? new Date(profile.notOnOrAfter as string).getTime()
      : 0;
    const assertionTtlSeconds =
      notOnOrAfterMs > Date.now()
        ? (notOnOrAfterMs - Date.now()) / 1000 + 60
        : 300;
    // Dedup on the signed assertion ID — the replay-stable anchor (it's inside
    // the signed element, unlike the surrounding bytes). Fall back to the
    // validated assertion XML, then the raw response, only if the ID is absent.
    const getAssertionXml = (
      profile as unknown as { getAssertionXml?: () => string }
    ).getAssertionXml;
    const assertionXml = getAssertionXml ? getAssertionXml() : "";
    const assertionId =
      assertionXml.match(
        /<(?:\w+:)?Assertion\b[^>]*\bID=["']([^"']+)["']/
      )?.[1] ||
      assertionXml ||
      (samlResponse as string);
    const isFreshAssertion = await registerSamlAssertion(
      assertionId,
      assertionTtlSeconds
    );
    if (!isFreshAssertion) {
      return NextResponse.json(
        { error: "SAML response has already been used" },
        { status: 400 }
      );
    }

    // Extract user attributes based on mapping. attributeMapping can be {} or
    // null (some IdPs send none), so default it and read keys null-safely.
    const attributeMapping = (samlConfig.attributeMapping as any) ?? {};
    const nameId = profile.nameID as string | undefined;
    const mappedEmail = profile[attributeMapping.email || "email"] as
      | string
      | undefined;
    // Accept the email carried in the NameID (Name ID format EmailAddress) when
    // there is no email attribute statement — a common IdP setup (e.g. Okta's
    // default). Only treat the NameID as an email when it actually looks like
    // one, since NameID is non-email in other configurations.
    const email =
      mappedEmail || (nameId && nameId.includes("@") ? nameId : undefined);
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

    // Guard before any use of email (name fallback, user lookup, provisioning).
    if (!email) {
      return NextResponse.json(
        { error: "Email not found in SAML response" },
        { status: 400 }
      );
    }

    // Construct full name from available fields, falling back to the email
    // local-part only once we know an email is present.
    let name = displayName;
    if (!name && (firstName || lastName)) {
      name = [firstName, lastName].filter(Boolean).join(" ");
    }
    if (!name) {
      name = email.split("@")[0];
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

      // Authentication through SAML satisfies email verification — the IdP
      // already asserted control of the address. Without this, an existing
      // user whose emailVerified is null gets trapped in the verify-email
      // gate even though they just proved control via the IdP.
      if (!user.emailVerified) {
        updates.emailVerified = new Date();
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

    // Create a one-time session token for secure user info transfer.
    const tempToken = await createTempSessionToken({
      userId: user.id,
      provider: `saml-${samlConfig.provider.name}`,
      email: user.email,
    });

    // Hand off to the completion route, which verifies the token and mints the
    // NextAuth session cookie before redirecting to the final destination.
    // Use 303 See Other so the IdP's POST does not get re-POSTed to /complete
    // (which only exports GET) — without this the browser would re-POST and
    // hit 405. NextResponse.redirect() defaults to 307, preserving method.
    const response = NextResponse.redirect(
      new URL(
        `/api/auth/saml/complete?token=${tempToken}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
        getAppBaseUrl(request)
      ),
      303
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
