import { OAuthConfig, OAuthUserConfig } from "next-auth/providers/oauth";
import { Profile as SAML2Profile } from "@node-saml/passport-saml";
import { SAML } from "@node-saml/node-saml";

export interface SAMLProfile extends Record<string, any> {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  nameID?: string;
  nameIDFormat?: string;
  nameQualifier?: string;
  spNameQualifier?: string;
  sessionIndex?: string;
}

export interface SAMLConfig {
  id?: string;
  name: string;
  // SAML specific options
  entryPoint: string;
  issuer: string;
  cert: string;
  privateKey?: string;
  decryptionPvk?: string;
  signatureAlgorithm?: "sha1" | "sha256" | "sha512";
  digestAlgorithm?: string;
  wantAssertionsSigned?: boolean;
  wantAuthnResponseSigned?: boolean;
  allowCreate?: boolean;
  identifierFormat?: string;
  acceptedClockSkewMs?: number;
  attributeConsumingServiceIndex?: string;
  disableRequestedAuthnContext?: boolean;
  authnContext?: string[];
  forceAuthn?: boolean;
  skipRequestCompression?: boolean;
  authnRequestBinding?: string;
  racComparison?: "exact" | "minimum" | "maximum" | "better";
  providerName?: string;
  passive?: boolean;
  idpIssuer?: string;
  audience?: string;
  scoping?: any; // SAML library expects SamlScopingConfig
  wantAssertionsEncrypted?: boolean;
  maxAssertionAgeMs?: number;
  // Attribute mapping
  profileMapping?: {
    id?: string;
    email?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
  };
}

export function SAMLProvider(options: SAMLConfig): OAuthConfig<SAMLProfile> {
  const { profileMapping = {} } = options;

  return {
    id: options.id || "saml",
    name: options.name || "SAML",
    type: "oauth",
    version: "2.0",

    // SAML doesn't use standard OAuth endpoints, but NextAuth requires these
    authorization: {
      url: options.entryPoint,
      params: {
        response_type: "code",
      },
    },
    token: {
      url: "", // Not used in SAML
    },
    userinfo: {
      url: "", // Not used in SAML
    },

    // Store SAML config for use in request handlers
    options: {
      clientId: options.issuer,
      clientSecret: "not-used-in-saml",
      ...options,
    } as OAuthUserConfig<SAMLProfile>,

    // Custom handlers for SAML flow
    checks: ["state"],

    profile(profile: SAMLProfile) {
      // Map SAML attributes to NextAuth profile
      const mapping = {
        id: profileMapping.id || "nameID",
        email: profileMapping.email || "email",
        name: profileMapping.name || "name",
        firstName: profileMapping.firstName || "firstName",
        lastName: profileMapping.lastName || "lastName",
      };

      let name = profile[mapping.name];

      // If name is not available, try to construct from firstName and lastName
      if (!name && (profile[mapping.firstName] || profile[mapping.lastName])) {
        const firstName = profile[mapping.firstName] || "";
        const lastName = profile[mapping.lastName] || "";
        name = `${firstName} ${lastName}`.trim();
      }

      // Fall back to email username if no name available
      if (!name && profile[mapping.email]) {
        name = profile[mapping.email].split("@")[0];
      }

      return {
        id: profile[mapping.id] || profile.nameID || profile.id,
        email: profile[mapping.email],
        name: name || profile.displayName || profile[mapping.email],
        image: null, // SAML typically doesn't provide avatar URLs
      };
    },

    // Style configuration
    style: {
      logo: "/saml-logo.svg",
      bg: "#f3f4f6",
      text: "#1f2937",
    },
  };
}

// Helper function to create SAML client
export async function createSAMLClient(config: SAMLConfig) {
  const samlOptions = {
    entryPoint: config.entryPoint,
    idpCert: config.cert, // node-saml expects idpCert not cert
    issuer: config.issuer,
    privateKey: config.privateKey,
    decryptionPvk: config.decryptionPvk,
    signatureAlgorithm: config.signatureAlgorithm,
    digestAlgorithm: config.digestAlgorithm,
    wantAssertionsSigned: config.wantAssertionsSigned,
    wantAuthnResponseSigned: config.wantAuthnResponseSigned,
    allowCreate: config.allowCreate,
    identifierFormat: config.identifierFormat,
    acceptedClockSkewMs: config.acceptedClockSkewMs,
    attributeConsumingServiceIndex: config.attributeConsumingServiceIndex,
    disableRequestedAuthnContext: config.disableRequestedAuthnContext,
    authnContext: config.authnContext,
    forceAuthn: config.forceAuthn,
    skipRequestCompression: config.skipRequestCompression,
    authnRequestBinding: config.authnRequestBinding,
    racComparison: config.racComparison,
    providerName: config.providerName,
    passive: config.passive,
    idpIssuer: config.idpIssuer,
    audience: config.audience,
    scoping: config.scoping,
    wantAssertionsEncrypted: config.wantAssertionsEncrypted,
    maxAssertionAgeMs: config.maxAssertionAgeMs,
    callbackUrl: `${process.env.NEXTAUTH_URL}/api/auth/callback/saml`,
  };

  return new SAML(samlOptions);
}

// Helper to validate SAML response
export async function validateSAMLResponse(
  samlClient: SAML,
  body: any
): Promise<SAML2Profile> {
  try {
    const profile = await samlClient.validatePostResponseAsync(body);
    return profile.profile as SAML2Profile;
  } catch (error) {
    console.error("SAML validation error:", error);
    throw new Error("Invalid SAML response");
  }
}
