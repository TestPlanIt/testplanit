import { createHash, createHmac, randomBytes } from "crypto";
import { isIP } from "net";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { getAppUrl } from "~/lib/appUrl";
import { getAuditContext } from "~/lib/auditContext";
import { needsEmailVerification } from "~/lib/auth/emailVerification";
import { BASE_PATH } from "~/lib/basePath";
import type { DbClient } from "~/lib/zenstack";

/**
 * Passkey (WebAuthn) sign-in.
 *
 * A passkey is a primary sign-in method alongside the password: the browser
 * proves possession of a key held by the user's device, unlocked with the
 * device's own check (biometric or PIN). Sign-in uses discoverable
 * credentials, so no email is typed and nothing here reveals whether an
 * account exists.
 *
 * The session itself is minted by the "passkey" NextAuth Credentials provider
 * (server/auth.ts), whose authorize() is authorizePasskey below.
 *
 * The WebAuthn library, the rate limiter and the audit service are imported
 * inside the functions that use them, so importing this module (server/auth.ts
 * does) stays free of Valkey and other heavy dependencies.
 */

/** The subset of the db client the flow touches (see PendingAuthDb). */
export type PasskeyDb = Pick<
  DbClient,
  "passkey" | "user" | "registrationSettings"
>;

export const PASSKEY_MAX_PER_USER = 10;

/** How long a browser has to answer a challenge. */
export const PASSKEY_CHALLENGE_TTL_SECONDS = 300;

/**
 * Key algorithms offered at registration (COSE ids for EdDSA, ES256, RS256).
 * Stated explicitly because the library's default list depends on what the
 * Node runtime supports, and a key registered on one runtime must verify on
 * every other.
 */
const PASSKEY_ALGORITHM_IDS = [-8, -7, -257];

const KNOWN_TRANSPORTS = new Set([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

/** Error strings the "passkey" provider's authorize() throws. */
export const PASSKEY_ERRORS = {
  failed: "PASSKEY_FAILED",
  unavailable: "PASSKEY_UNAVAILABLE",
  rate_limited: "PASSKEY_RATE_LIMITED",
} as const;

export interface PasskeyRelyingParty {
  /** The host passkeys are bound to. */
  rpID: string;
  /** The origin the browser must report. */
  origin: string;
  /** False when the install's address cannot host passkeys at all. */
  eligible: boolean;
}

/**
 * The relying party, taken from the install's configured address. Passkeys
 * are bound to the host, not the path, so an install under a path prefix
 * shares its host's id. Browsers only offer WebAuthn over HTTPS or on
 * localhost, and never for an IP address.
 */
export function getPasskeyRelyingParty(
  env: Record<string, string | undefined> = process.env
): PasskeyRelyingParty {
  let url: URL;
  try {
    url = new URL(getAppUrl(env));
  } catch {
    return { rpID: "", origin: "", eligible: false };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const eligible =
    isIP(host) === 0 && (url.protocol === "https:" || host === "localhost");
  return { rpID: host, origin: url.origin, eligible };
}

export type PasskeyUnavailableReason =
  "ineligible_host" | "disabled" | "force_sso";

export type PasskeyAvailability =
  { available: true } | { available: false; reason: PasskeyUnavailableReason };

/**
 * Whether passkey sign-in is on for this install: the address can host
 * passkeys, an administrator has not switched them off, and Force SSO is off.
 */
export async function getPasskeyAvailability(
  db: Pick<PasskeyDb, "registrationSettings">
): Promise<PasskeyAvailability> {
  if (!getPasskeyRelyingParty().eligible) {
    return { available: false, reason: "ineligible_host" };
  }
  const settings = await db.registrationSettings.findFirst({
    select: { allowPasskeys: true },
  });
  if (settings?.allowPasskeys === false) {
    return { available: false, reason: "disabled" };
  }
  const { isForceSsoEnabled } = await import("~/lib/utils/force-sso");
  if (await isForceSsoEnabled()) {
    return { available: false, reason: "force_sso" };
  }
  return { available: true };
}

/**
 * Whether a browser request was made from the address passkeys are bound to.
 *
 * A passkey created or used from any other address (a different host, scheme
 * or port than the configured application URL) can never be verified, so the
 * routes check this before the browser is asked for one. Otherwise the device
 * ends up holding a passkey the server never stored. Requests without an
 * Origin header are not judged here; verification still checks the origin.
 */
export function isPasskeyOrigin(
  requestOrigin: string | null | undefined
): boolean {
  if (!requestOrigin) return true;
  const expectedOrigin = getPasskeyRelyingParty().origin;
  if (requestOrigin === expectedOrigin) return true;
  console.warn(
    "Passkey request from an address other than the configured one",
    {
      expectedOrigin,
      requestOrigin,
    }
  );
  return false;
}

/** Passkeys belong to accounts that sign in with a password of their own. */
export function canUsePasskeys(authMethod: string | null | undefined): boolean {
  return authMethod === "INTERNAL" || authMethod === "BOTH";
}

/**
 * The account id a device is given when a passkey is created (WebAuthn's user
 * handle), base64url-encoded.
 *
 * A device keeps one passkey per host per account id, and a passkey belongs
 * to the host, not the path. Two installs under different prefixes on one
 * host therefore share a host, and often user ids as well (a staging copy of
 * production). Mixing the prefix in keeps them apart: without it, adding a
 * passkey on one install would replace the other install's on the device.
 *
 * The value is stored with each passkey and sign-in compares against what was
 * stored, so changing how this is built never invalidates existing passkeys.
 */
export function getPasskeyUserHandle(
  userId: string,
  basePath: string = BASE_PATH
): string {
  return createHash("sha256")
    .update(`${basePath}\n${userId}`)
    .digest("base64url");
}

/**
 * The account name the browser shows when it lists passkeys. On an install
 * under a path prefix it names the prefix, since every install on the host
 * appears in the same list.
 */
export function getPasskeyAccountLabel(
  email: string,
  basePath: string = BASE_PATH
): string {
  return basePath ? `${email} (${basePath})` : email;
}

type PasskeyChallengePurpose = "register" | "authenticate";

function getChallengeKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not configured");
  }
  // A key of its own, so a challenge token can never stand in for any other
  // token the app signs with the same secret, nor the other way round.
  return createHmac("sha256", secret)
    .update("tpi:passkey-challenge:v1")
    .digest();
}

/**
 * Wrap a WebAuthn challenge in a signed, short-lived token the browser echoes
 * back with its answer. Nothing is stored when a challenge is issued; the
 * token is marked spent when it is consumed.
 */
export function createPasskeyChallengeToken(
  purpose: PasskeyChallengePurpose,
  challenge: string,
  userId?: string
): string {
  return jwt.sign(
    { challenge, ...(userId ? { uid: userId } : {}) },
    getChallengeKey(),
    {
      algorithm: "HS256",
      audience: `passkey:${purpose}`,
      expiresIn: PASSKEY_CHALLENGE_TTL_SECONDS,
      jwtid: randomBytes(16).toString("hex"),
    }
  );
}

/**
 * Verify a challenge token and spend it. Returns the challenge, or null when
 * the token is invalid, expired, issued for another purpose or another user,
 * or already used.
 */
export async function consumePasskeyChallengeToken(
  token: string | null | undefined,
  purpose: PasskeyChallengePurpose,
  userId?: string
): Promise<string | null> {
  if (!token) return null;

  let decoded: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, getChallengeKey(), {
      algorithms: ["HS256"],
      audience: `passkey:${purpose}`,
    });
    if (typeof verified === "string") return null;
    decoded = verified;
  } catch {
    return null;
  }

  if (typeof decoded.challenge !== "string" || !decoded.jti || !decoded.exp) {
    return null;
  }
  if (purpose === "register" && (!userId || decoded.uid !== userId)) {
    return null;
  }

  const secondsLeft = decoded.exp - Math.floor(Date.now() / 1000);
  const { consumeOnce } = await import("~/lib/auth-security");
  const firstUse = await consumeOnce(
    `passkey:challenge:${decoded.jti}`,
    secondsLeft
  );
  return firstUse ? decoded.challenge : null;
}

const base64Url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

const AuthenticationResponseSchema = z.object({
  id: base64Url(1024),
  rawId: base64Url(1024),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64Url(8192),
    authenticatorData: base64Url(8192),
    signature: base64Url(8192),
    // Always present for the discoverable credentials this flow asks for.
    userHandle: base64Url(512),
  }),
  authenticatorAttachment: z.string().max(32).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
});

const RegistrationResponseSchema = z.object({
  id: base64Url(1024),
  rawId: base64Url(1024),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64Url(8192),
    attestationObject: base64Url(65536),
    authenticatorData: base64Url(8192).optional(),
    transports: z.array(z.string().max(32)).max(10).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: base64Url(8192).optional(),
  }),
  authenticatorAttachment: z.string().max(32).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
});

function logVerificationFailure(
  ceremony: "registration" | "sign-in",
  rp: PasskeyRelyingParty,
  error: unknown
): void {
  // The library's message names the origin or host the browser reported, which
  // is what a wrong APP_URL / NEXTAUTH_URL shows up as.
  console.warn(`Passkey ${ceremony} could not be verified`, {
    expectedOrigin: rp.origin,
    expectedRpId: rp.rpID,
    error: error instanceof Error ? error.message : String(error),
  });
}

/** Options for navigator.credentials.get() plus the token to echo back. */
export async function buildPasskeyAuthenticationOptions(): Promise<{
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeToken: string;
}> {
  const rp = getPasskeyRelyingParty();
  const { generateAuthenticationOptions } =
    await import("@simplewebauthn/server");
  // No credential list: the browser offers whatever passkeys it holds for
  // this host, so the request names no account.
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "required",
  });
  return {
    options,
    challengeToken: createPasskeyChallengeToken(
      "authenticate",
      options.challenge
    ),
  };
}

export type PasskeyRegistrationOptionsResult =
  | {
      ok: true;
      options: PublicKeyCredentialCreationOptionsJSON;
      challengeToken: string;
    }
  | { ok: false; reason: "limit_reached" };

/** Options for navigator.credentials.create() plus the token to echo back. */
export async function buildPasskeyRegistrationOptions(
  db: PasskeyDb,
  user: { id: string; email: string; name: string | null }
): Promise<PasskeyRegistrationOptionsResult> {
  const existing = await db.passkey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });
  if (existing.length >= PASSKEY_MAX_PER_USER) {
    return { ok: false, reason: "limit_reached" };
  }

  const rp = getPasskeyRelyingParty();
  const [{ generateRegistrationOptions }, { APP_NAME }] = await Promise.all([
    import("@simplewebauthn/server"),
    import("~/lib/two-factor"),
  ]);
  const options = await generateRegistrationOptions({
    rpName: APP_NAME,
    rpID: rp.rpID,
    userName: getPasskeyAccountLabel(user.email),
    userDisplayName: user.name || user.email,
    // The user handle the authenticator hands back at sign-in.
    userID: new Uint8Array(
      Buffer.from(getPasskeyUserHandle(user.id), "base64url")
    ),
    attestationType: "none",
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    supportedAlgorithmIDs: PASSKEY_ALGORITHM_IDS,
  });
  return {
    ok: true,
    options,
    challengeToken: createPasskeyChallengeToken(
      "register",
      options.challenge,
      user.id
    ),
  };
}

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export type PasskeyRegistrationResult =
  | { ok: true; passkey: PasskeySummary }
  | {
      ok: false;
      reason:
        | "malformed"
        | "challenge_invalid"
        | "verification_failed"
        | "duplicate"
        | "limit_reached";
    };

/** Verify the browser's answer to a registration challenge and store the key. */
export async function completePasskeyRegistration(
  db: PasskeyDb,
  input: {
    userId: string;
    response: unknown;
    challengeToken: string | null | undefined;
    name: string;
  }
): Promise<PasskeyRegistrationResult> {
  const parsed = RegistrationResponseSchema.safeParse(input.response);
  if (!parsed.success) return { ok: false, reason: "malformed" };

  const challenge = await consumePasskeyChallengeToken(
    input.challengeToken,
    "register",
    input.userId
  );
  if (!challenge) return { ok: false, reason: "challenge_invalid" };

  const rp = getPasskeyRelyingParty();
  const { verifyRegistrationResponse } = await import("@simplewebauthn/server");
  const verification = await verifyRegistrationResponse({
    response: parsed.data as RegistrationResponseJSON,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: PASSKEY_ALGORITHM_IDS,
  }).catch((error: unknown) => {
    logVerificationFailure("registration", rp, error);
    return null;
  });
  if (!verification?.verified) {
    return { ok: false, reason: "verification_failed" };
  }
  const info = verification.registrationInfo;

  const [count, duplicate] = await Promise.all([
    db.passkey.count({ where: { userId: input.userId } }),
    db.passkey.findUnique({
      where: { credentialId: info.credential.id },
      select: { id: true },
    }),
  ]);
  if (duplicate) return { ok: false, reason: "duplicate" };
  if (count >= PASSKEY_MAX_PER_USER) {
    return { ok: false, reason: "limit_reached" };
  }

  const transports = (
    parsed.data.response.transports ??
    info.credential.transports ??
    []
  ).filter((transport) => KNOWN_TRANSPORTS.has(transport));

  const passkey = await db.passkey.create({
    data: {
      userId: input.userId,
      credentialId: info.credential.id,
      // The same value the registration options handed to the device.
      userHandle: getPasskeyUserHandle(input.userId),
      publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
      counter: BigInt(info.credential.counter),
      transports,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      aaguid: info.aaguid || null,
      name: input.name,
    },
    select: { id: true, name: true, createdAt: true, lastUsedAt: true },
  });
  return { ok: true, passkey };
}

/**
 * authorize() for the "passkey" NextAuth Credentials provider: the single
 * place a passkey assertion is exchanged for a session.
 *
 * Returns the same { id, email, name } shape as the password flow, so the
 * jwt/session callbacks in server/auth.ts populate identical claims. The
 * account's password lockout is neither read nor advanced: a passkey cannot be
 * guessed, and the owner must be able to get in while someone else is locking
 * the password.
 */
export function authorizePasskey(db: PasskeyDb) {
  return async (
    credentials:
      Partial<Record<"response" | "challengeToken", string>> | undefined
  ): Promise<{ id: string; email: string; name: string | null } | null> => {
    const [{ checkRateLimit }, { auditAuthEvent }] = await Promise.all([
      import("~/lib/auth-security"),
      import("~/lib/services/auditLog"),
    ]);
    const refuse = (
      reason: string,
      user?: { id: string; email: string } | null
    ): Error => {
      auditAuthEvent("LOGIN_FAILED", user?.id ?? null, user?.email ?? "", {
        provider: "passkey",
        reason,
      }).catch(console.error);
      return new Error(PASSKEY_ERRORS.failed);
    };

    const ip = getAuditContext()?.ipAddress ?? "unknown";
    const allowed = await checkRateLimit(`passkey:signin:ip:${ip}`, {
      windowMs: 60_000,
      maxAttempts: 10,
    });
    if (!allowed) throw new Error(PASSKEY_ERRORS.rate_limited);

    const availability = await getPasskeyAvailability(db);
    if (!availability.available) {
      auditAuthEvent("LOGIN_FAILED", null, "", {
        provider: "passkey",
        reason: `passkey_${availability.reason}`,
      }).catch(console.error);
      throw new Error(PASSKEY_ERRORS.unavailable);
    }

    let assertion: z.infer<typeof AuthenticationResponseSchema>;
    try {
      assertion = AuthenticationResponseSchema.parse(
        JSON.parse(credentials?.response ?? "")
      );
    } catch {
      throw refuse("passkey_malformed");
    }

    const challenge = await consumePasskeyChallengeToken(
      credentials?.challengeToken,
      "authenticate"
    );
    if (!challenge) throw refuse("passkey_challenge_invalid");

    const passkey = await db.passkey.findUnique({
      where: { credentialId: assertion.id },
      select: {
        id: true,
        userId: true,
        credentialId: true,
        userHandle: true,
        publicKey: true,
        counter: true,
        transports: true,
      },
    });
    if (!passkey) throw refuse("passkey_unknown_credential");

    // The device hands back the account id it was given at registration; it
    // must be the one stored with this passkey.
    if (assertion.response.userHandle !== passkey.userHandle) {
      throw refuse("passkey_user_handle_mismatch");
    }

    const rp = getPasskeyRelyingParty();
    const { verifyAuthenticationResponse } =
      await import("@simplewebauthn/server");
    const verification = await verifyAuthenticationResponse({
      response: assertion as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64url")),
        counter: Number(passkey.counter),
        transports: passkey.transports,
      },
      requireUserVerification: true,
    }).catch((error: unknown) => {
      logVerificationFailure("sign-in", rp, error);
      return null;
    });
    if (!verification?.verified) throw refuse("passkey_verification_failed");

    // The account is only looked at once possession of the key is proven, so
    // knowing a credential id is not enough to write audit rows against it.
    const user = await db.user.findUnique({
      where: { id: passkey.userId },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        isDeleted: true,
        authMethod: true,
        emailVerified: true,
      },
    });
    if (!user || !user.isActive || user.isDeleted) {
      throw refuse(user ? "user_inactive" : "user_not_found", user);
    }
    if (!canUsePasskeys(user.authMethod)) {
      throw refuse("passkey_auth_method", user);
    }
    if (needsEmailVerification(user)) {
      throw refuse("email_not_verified", user);
    }

    await db.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
        backedUp: verification.authenticationInfo.credentialBackedUp,
      },
    });

    auditAuthEvent(
      "LOGIN",
      user.id,
      user.email,
      { provider: "passkey" },
      user.name
    ).catch(console.error);

    return { id: user.id, email: user.email, name: user.name };
  };
}
