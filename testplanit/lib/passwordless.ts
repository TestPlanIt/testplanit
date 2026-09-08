import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { DbClient } from "~/lib/zenstack";

/**
 * Device-bound magic-link + OTP sign-in ("passwordless").
 *
 * Replaces the stock NextAuth EmailProvider flow, whose single-use
 * VerificationToken is consumed on the GET of the callback link. Corporate
 * mail scanners (Microsoft Safe Links, Mimecast, Proofpoint, Barracuda)
 * prefetch every link at delivery time, consuming the token before the human
 * clicks — the user then sees "link expired".
 *
 * This flow issues three secrets per sign-in request:
 *
 *   verifier   256-bit secret set as an HttpOnly cookie in the REQUESTING
 *              browser only. Never appears in the email.
 *   linkToken  256-bit secret embedded in the emailed link.
 *   code       short human-relay code shown in the email, for completing from
 *              the original window when the link was opened elsewhere.
 *
 * Completion requires the verifier (proof of the original browser) PLUS one
 * email-derived proof (linkToken or code). The emailed URL alone is inert:
 * a scanner GET renders a page and consumes nothing; consumption happens only
 * at final completion via an atomic conditional update.
 *
 * Only HMAC-SHA256 hashes of the secrets are stored (keyed with
 * NEXTAUTH_SECRET so a DB dump alone cannot be brute-forced offline).
 */

/** Max wrong code entries before the pending row is locked. */
export const PASSWORDLESS_MAX_CODE_ATTEMPTS = 5;

/**
 * Lifetime of a pending sign-in. Generous on purpose: university/corporate
 * mail can take many minutes to deliver. The verifier cookie max-age matches.
 */
export const PASSWORDLESS_TTL_MINUTES = 45;

/** Human-relay code length (displayed as XXXX-XXXX). */
export const PASSWORDLESS_CODE_LENGTH = 8;

/**
 * Unambiguous code alphabet (Crockford-style): no 0/O, 1/I/L or U to avoid
 * transcription errors when the code is read off a phone screen.
 */
export const PASSWORDLESS_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/**
 * Feature flag: the device-bound flow (scanner-proof magic link + sign-in
 * code) is the default. A deployment opts out by setting
 * PASSWORDLESS_DEVICE_BOUND to "false", which falls back to the stock NextAuth
 * email flow (a plain clickable link).
 */
export function isPasswordlessDeviceBoundEnabled(): boolean {
  return process.env.PASSWORDLESS_DEVICE_BOUND?.toLowerCase() !== "false";
}

function secureCookiesEnabled(): boolean {
  return (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
}

/**
 * Verifier cookie name. Mirrors NextAuth's convention of a __Secure- prefix
 * when the app is served over https (the prefix is rejected by browsers on
 * plain http, e.g. local dev / E2E).
 */
export function getVerifierCookieName(): string {
  return secureCookiesEnabled()
    ? "__Secure-tpi.passwordless-verifier"
    : "tpi.passwordless-verifier";
}

/**
 * Cookie attributes for the verifier.
 *
 * - SameSite=Lax (NOT Strict): the cookie must ride the top-level GET
 *   navigation from the email client to /api/auth/passwordless/callback;
 *   Strict would omit it and every same-browser click would fall back to the
 *   code path.
 * - Path-scoped to /api/auth: covers the link callback AND the NextAuth
 *   credentials callback (/api/auth/callback/passwordless-complete) that
 *   mints the session, and nothing else.
 */
export function getVerifierCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: secureCookiesEnabled(),
    sameSite: "lax",
    path: "/api/auth",
    maxAge: PASSWORDLESS_TTL_MINUTES * 60,
  };
}

function getHmacKey(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not configured");
  }
  return secret;
}

/**
 * HMAC-SHA256 (hex) of a secret, keyed with NEXTAUTH_SECRET.
 *
 * Used for the verifier and link token ONLY — both are 256-bit random values,
 * so a slow KDF adds nothing (key stretching defends low-entropy human
 * secrets; 2^256 is not brute-forceable at any hash speed) while the HMAC key
 * keeps a DB-dump-only attacker from verifying guesses at all. The
 * low-entropy relay code uses bcrypt on top of this — see
 * hashPasswordlessCode.
 */
export function hashPasswordlessSecret(value: string): string {
  return createHmac("sha256", getHmacKey()).update(value).digest("hex");
}

/** Constant-time comparison of a candidate secret against a stored hash. */
export function passwordlessSecretMatches(
  storedHash: string,
  candidate: string
): boolean {
  const candidateHash = hashPasswordlessSecret(candidate);
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(candidateHash, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

// bcrypt cost for the relay code — matches the credentials flow's cost
// (server/auth.ts). One hash per request and at most 5 compares per pending
// row, so the latency is negligible for this path.
const CODE_BCRYPT_ROUNDS = 10;

/**
 * Slow hash for the human relay code: bcrypt over the HMAC pre-hash.
 *
 * The code is the one low-entropy secret in this flow (~2^39 for 8 chars of
 * a 30-char alphabet), so unlike the 256-bit verifier/link token it gets key
 * stretching: an attacker holding BOTH a DB dump and NEXTAUTH_SECRET still
 * faces bcrypt cost per guess. The HMAC layer underneath keeps a DB-only
 * dump unverifiable, exactly like the other secrets.
 *
 * bcrypt is imported lazily so pages that only need the pure helpers don't
 * load the native module.
 */
export async function hashPasswordlessCode(code: string): Promise<string> {
  const { hash } = await import("bcrypt");
  return hash(hashPasswordlessSecret(code), CODE_BCRYPT_ROUNDS);
}

/** bcrypt comparison of a candidate relay code against a stored code hash. */
export async function passwordlessCodeMatches(
  storedHash: string,
  candidate: string
): Promise<boolean> {
  if (!storedHash || !candidate) return false;
  const { compare } = await import("bcrypt");
  return compare(hashPasswordlessSecret(candidate), storedHash);
}

/** 256-bit URL-safe random secret (verifier / link token). */
export function generatePasswordlessSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Random human-relay code from the unambiguous alphabet. */
export function generatePasswordlessCode(): string {
  // Rejection sampling keeps the distribution uniform across the alphabet.
  const alphabet = PASSWORDLESS_CODE_ALPHABET;
  const max = 256 - (256 % alphabet.length);
  let code = "";
  while (code.length < PASSWORDLESS_CODE_LENGTH) {
    for (const byte of randomBytes(PASSWORDLESS_CODE_LENGTH * 2)) {
      if (byte < max) {
        code += alphabet[byte % alphabet.length];
        if (code.length === PASSWORDLESS_CODE_LENGTH) break;
      }
    }
  }
  return code;
}

/** XXXX-XXXX display form. */
export function formatPasswordlessCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * Normalize user code entry: uppercase, strip separators/whitespace. The
 * alphabet excludes the characters people confuse (0/O, 1/I/L), so no
 * character substitution is needed.
 */
export function normalizePasswordlessCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

export function isValidPasswordlessCodeFormat(code: string): boolean {
  if (code.length !== PASSWORDLESS_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!PASSWORDLESS_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** Value stored in the verifier cookie: "v1.<pendingId>.<verifier>". */
export function encodeVerifierCookie(
  pendingId: string,
  verifier: string
): string {
  return `v1.${pendingId}.${verifier}`;
}

export function decodeVerifierCookie(
  value: string | undefined | null
): { pendingId: string; verifier: string } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) {
    return null;
  }
  return { pendingId: parts[1], verifier: parts[2] };
}

/**
 * Extract the verifier cookie from a raw Cookie header (the shape NextAuth v4
 * hands to a credentials provider's authorize via req.headers).
 */
export function parseVerifierFromCookieHeader(
  cookieHeader: string | undefined | null
): { pendingId: string; verifier: string } | null {
  if (!cookieHeader) return null;
  const target = `${getVerifierCookieName()}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      return decodeVerifierCookie(
        decodeURIComponent(trimmed.slice(target.length))
      );
    }
  }
  return null;
}

/**
 * Validate a NextAuth double-submit CSRF token against the request's CSRF
 * cookie ("<token>|<sha256(token+secret)>"). Used by the passwordless request
 * endpoint so the waiting-window POST reuses Auth.js CSRF instead of a
 * parallel mechanism.
 */
export function validateNextAuthCsrf(
  cookieHeader: string | undefined | null,
  submittedToken: string | undefined | null
): boolean {
  if (!cookieHeader || !submittedToken) return false;
  const names = ["__Host-next-auth.csrf-token=", "next-auth.csrf-token="];
  let cookieValue: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    for (const name of names) {
      if (trimmed.startsWith(name)) {
        cookieValue = decodeURIComponent(trimmed.slice(name.length));
        break;
      }
    }
    if (cookieValue) break;
  }
  if (!cookieValue) return false;
  const [cookieToken, cookieHash] = cookieValue.split("|");
  if (!cookieToken || !cookieHash) return false;
  const expectedHash = createHash("sha256")
    .update(`${cookieToken}${getHmacKey()}`)
    .digest("hex");
  const hashesMatch =
    cookieHash.length === expectedHash.length &&
    timingSafeEqual(Buffer.from(cookieHash), Buffer.from(expectedHash));
  if (!hashesMatch) return false;
  return (
    cookieToken.length === submittedToken.length &&
    timingSafeEqual(Buffer.from(cookieToken), Buffer.from(submittedToken))
  );
}

export interface CreatedPendingAuth {
  id: string;
  verifier: string;
  linkToken: string;
  code: string;
  expiresAt: Date;
}

// The subset of the db client the flow touches — keeps tests free to pass a
// narrow mock and keeps this module decoupled from the hooked client.
export type PendingAuthDb = Pick<DbClient, "pendingAuth" | "user">;

/**
 * Create a new pending sign-in for an email address.
 *
 * Always creates a row — even when no account exists for the email — so the
 * request endpoint behaves identically for real and unknown accounts (no
 * user enumeration). Previous pending rows for the same email are superseded
 * so only the latest emailed link/code is live, and long-expired rows are
 * opportunistically purged (ephemeral security material, not business data).
 */
export async function createPendingAuth(
  db: PendingAuthDb,
  args: {
    email: string;
    callbackUrl?: string | null;
    requestIp?: string | null;
    requestUserAgent?: string | null;
  }
): Promise<CreatedPendingAuth> {
  const verifier = generatePasswordlessSecret();
  const linkToken = generatePasswordlessSecret();
  const code = generatePasswordlessCode();
  const expiresAt = new Date(Date.now() + PASSWORDLESS_TTL_MINUTES * 60_000);

  await db.pendingAuth.updateMany({
    where: {
      email: { equals: args.email, mode: "insensitive" },
      status: "PENDING",
    },
    data: { status: "SUPERSEDED" },
  });

  // Ephemeral auth material: purge rows expired for over a day (same
  // hard-delete treatment NextAuth gives VerificationToken rows).
  await db.pendingAuth
    .deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } },
    })
    .catch(() => undefined);

  const row = await db.pendingAuth.create({
    data: {
      email: args.email,
      verifierHash: hashPasswordlessSecret(verifier),
      linkTokenHash: hashPasswordlessSecret(linkToken),
      codeHash: await hashPasswordlessCode(code),
      callbackUrl: args.callbackUrl ?? null,
      requestIp: args.requestIp ?? null,
      requestUserAgent: args.requestUserAgent ?? null,
      expiresAt,
    },
  });

  return { id: row.id, verifier, linkToken, code, expiresAt };
}

export type PendingAuthRow = {
  id: string;
  email: string;
  verifierHash: string;
  linkTokenHash: string;
  codeHash: string;
  status: string;
  attempts: number;
  callbackUrl: string | null;
  expiresAt: Date;
};

export type LinkInspection =
  | { kind: "valid"; row: PendingAuthRow }
  | { kind: "invalid" }
  | { kind: "expired" };

/**
 * Read-only validation of an emailed link (pid + linkToken). Used by the GET
 * callback, which MUST be side-effect-free: a scanner can hit it any number
 * of times without changing state.
 */
export async function inspectPendingAuthLink(
  db: PendingAuthDb,
  pendingId: string,
  linkToken: string
): Promise<LinkInspection> {
  if (!pendingId || !linkToken) return { kind: "invalid" };
  const row = await db.pendingAuth.findUnique({ where: { id: pendingId } });
  if (!row) return { kind: "invalid" };
  if (!passwordlessSecretMatches(row.linkTokenHash, linkToken)) {
    return { kind: "invalid" };
  }
  if (row.status !== "PENDING") return { kind: "expired" };
  if (row.expiresAt.getTime() <= Date.now()) return { kind: "expired" };
  return { kind: "valid", row };
}

export type ConsumeFailureReason =
  | "invalid" // unknown row, bad verifier/linkToken, no user, superseded/consumed
  | "expired"
  | "locked"
  | "invalid_code";

export type ConsumeResult =
  | { ok: true; email: string; callbackUrl: string | null }
  | { ok: false; reason: ConsumeFailureReason };

/**
 * Final completion: validate verifier + (linkToken | code) and consume the
 * pending row exactly once.
 *
 * The consume is a conditional UPDATE ... WHERE status='PENDING' (updateMany
 * so the guard is in the WHERE clause, not a read-then-write); under
 * concurrent completions exactly one caller observes count === 1. Plain CRUD,
 * no interactive transaction — safe under PgBouncer transaction pooling.
 */
export async function consumePendingAuth(
  db: PendingAuthDb,
  args: {
    pendingId: string;
    verifier: string;
    linkToken?: string;
    code?: string;
  }
): Promise<ConsumeResult> {
  const { pendingId, verifier, linkToken, code } = args;
  if (!pendingId || !verifier || (!linkToken && !code)) {
    return { ok: false, reason: "invalid" };
  }

  const row = await db.pendingAuth.findUnique({ where: { id: pendingId } });
  if (!row) return { ok: false, reason: "invalid" };

  // Verifier first: it proves control of the original requesting browser.
  // A mismatch is not counted against the code-attempt budget (the verifier
  // is 256-bit — the budget exists for the short human code).
  if (!passwordlessSecretMatches(row.verifierHash, verifier)) {
    return { ok: false, reason: "invalid" };
  }

  if (row.status === "LOCKED") return { ok: false, reason: "locked" };
  if (row.status !== "PENDING") return { ok: false, reason: "expired" };
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (row.attempts >= PASSWORDLESS_MAX_CODE_ATTEMPTS) {
    return { ok: false, reason: "locked" };
  }

  if (linkToken) {
    if (!passwordlessSecretMatches(row.linkTokenHash, linkToken)) {
      return { ok: false, reason: "invalid" };
    }
  } else {
    const normalized = normalizePasswordlessCode(code!);
    if (!(await passwordlessCodeMatches(row.codeHash, normalized))) {
      const updated = await db.pendingAuth.update({
        where: { id: pendingId },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      if (updated.attempts >= PASSWORDLESS_MAX_CODE_ATTEMPTS) {
        await db.pendingAuth.updateMany({
          where: { id: pendingId, status: "PENDING" },
          data: { status: "LOCKED" },
        });
        return { ok: false, reason: "locked" };
      }
      return { ok: false, reason: "invalid_code" };
    }
  }

  // Atomic single-shot consume: the status guard lives in the WHERE clause,
  // so two racing completions can't both succeed.
  const consumed = await db.pendingAuth.updateMany({
    where: {
      id: pendingId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    data: { status: "CONSUMED", consumedAt: new Date() },
  });
  if (consumed.count !== 1) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, email: row.email, callbackUrl: row.callbackUrl };
}

/**
 * Error codes surfaced to the sign-in UI through NextAuth's
 * signIn(..., { redirect: false }) error channel (same mechanism as the
 * existing 2FA_REQUIRED flow). Mapped to localized messages client-side.
 */
export const PASSWORDLESS_ERRORS = {
  invalid: "PASSWORDLESS_INVALID",
  no_verifier: "PASSWORDLESS_NO_VERIFIER",
  expired: "PASSWORDLESS_EXPIRED",
  locked: "PASSWORDLESS_LOCKED",
  invalid_code: "PASSWORDLESS_INVALID_CODE",
} as const;

/**
 * authorize() for the "passwordless-complete" NextAuth Credentials provider —
 * the single place a pending sign-in is exchanged for a session.
 *
 * Accepts { pendingId, linkToken } (same-browser link click) or
 * { pendingId, code } (cross-device relay). The device-binding verifier is
 * never a credential the client script can supply: it is read from the
 * HttpOnly cookie on the request, so possession of the emailed URL alone can
 * never complete a sign-in.
 *
 * Returns the same { id, email, name } user shape as the existing credentials
 * and email flows, so the jwt/session callbacks in server/auth.ts populate
 * identical claims (token.access, isApi, 2FA enforcement, ...).
 */
export function authorizePasswordlessComplete(prisma: PendingAuthDb) {
  return async (
    credentials:
      Partial<Record<"pendingId" | "linkToken" | "code", string>> | undefined,
    req: { headers?: Record<string, unknown> }
  ): Promise<{ id: string; email: string; name: string | null } | null> => {
    if (!isPasswordlessDeviceBoundEnabled()) return null;

    if (!credentials?.linkToken && !credentials?.code) {
      throw new Error(PASSWORDLESS_ERRORS.invalid);
    }

    const cookieHeader =
      typeof req?.headers?.cookie === "string" ? req.headers.cookie : null;
    const bound = parseVerifierFromCookieHeader(cookieHeader);
    if (
      !bound ||
      (credentials.pendingId && bound.pendingId !== credentials.pendingId)
    ) {
      // Original window lost its cookie (or a foreign browser is posting):
      // the UI tells the user to request a fresh link.
      throw new Error(PASSWORDLESS_ERRORS.no_verifier);
    }

    // pendingId may be omitted (e.g. the sign-in dialog was closed and
    // reopened, losing its client state): the verifier cookie already names
    // the one pending sign-in this browser requested, so fall back to it.
    // When the client does send an id it must match the cookie's.
    const pendingId = credentials.pendingId || bound.pendingId;

    const result = await consumePendingAuth(prisma, {
      pendingId,
      verifier: bound.verifier,
      linkToken: credentials.linkToken || undefined,
      code: credentials.code || undefined,
    });

    // Dynamic import keeps this module import-light for the pages that only
    // need the pure helpers (same pattern as two-factor in server/auth.ts).
    const { auditAuthEvent } = await import("~/lib/services/auditLog");

    if (!result.ok) {
      auditAuthEvent("LOGIN_FAILED", null, "", {
        provider: "passwordless-complete",
        reason: `passwordless_${result.reason}`,
        pendingId,
      }).catch(console.error);
      throw new Error(
        result.reason === "invalid"
          ? PASSWORDLESS_ERRORS.invalid
          : PASSWORDLESS_ERRORS[result.reason]
      );
    }

    // Emails match case-insensitively; an exact-cased row wins when
    // case-variant duplicates exist.
    const user =
      (await prisma.user.findUnique({
        where: { email: result.email },
        select: { id: true, email: true, name: true, isActive: true },
      })) ??
      (await prisma.user.findFirst({
        where: { email: { equals: result.email, mode: "insensitive" } },
        select: { id: true, email: true, name: true, isActive: true },
      }));
    if (!user || !user.isActive) {
      // Row was created for an unknown address (anti-enumeration) or the
      // account was deactivated since the request. Generic failure.
      auditAuthEvent("LOGIN_FAILED", user?.id ?? null, result.email, {
        provider: "passwordless-complete",
        reason: user ? "user_inactive" : "user_not_found",
      }).catch(console.error);
      throw new Error(PASSWORDLESS_ERRORS.invalid);
    }

    // Successful LOGIN is audited by the signIn callback in server/auth.ts
    // (non-credentials branch), same as the stock email provider.
    return { id: user.id, email: user.email, name: user.name };
  };
}
