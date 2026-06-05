import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import valkeyConnection from "./valkey";

// Generate secure state parameter for OAuth/SAML flows
export function generateSecureState(): string {
  return randomBytes(32).toString("base64url");
}

// Verify state parameter
export function verifyState(
  storedState: string | undefined,
  receivedState: string | undefined
): boolean {
  if (!storedState || !receivedState) return false;
  return storedState === receivedState;
}

// Generate CSRF token
export function generateCSRFToken(): string {
  return randomBytes(32).toString("hex");
}

// Hash sensitive data for storage
export function hashData(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

// Validate redirect URLs to prevent open redirects
export function isValidRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url, process.env.NEXTAUTH_URL);

    // Only allow relative URLs or URLs to the same origin
    if (url.startsWith("/") && !url.startsWith("//")) {
      return true;
    }

    const appUrl = new URL(process.env.NEXTAUTH_URL || "");
    return parsed.origin === appUrl.origin;
  } catch {
    return false;
  }
}

// Sanitize callback URL
export function sanitizeCallbackUrl(url: string | null | undefined): string {
  if (!url) return "/";
  if (isValidRedirectUrl(url)) return url;
  return "/";
}

/**
 * Resolve the externally-reachable base URL for building absolute redirects.
 *
 * Behind a reverse proxy or k3s ingress the incoming request host is the
 * internal pod name (e.g. my-pod-abc123:3000), so absolute URLs built from
 * `request.url` send the browser to an unreachable address. Prefer the
 * configured public origin, then proxy-forwarded headers, then the request.
 */
export function getAppBaseUrl(request?: Request): string {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL.replace(/\/$/, "");
  }

  if (request) {
    const forwardedHost = request.headers.get("x-forwarded-host");
    if (forwardedHost) {
      const forwardedProto =
        request.headers.get("x-forwarded-proto") ?? "https";
      return `${forwardedProto}://${forwardedHost}`;
    }
    return new URL(request.url).origin;
  }

  return "http://localhost:3000";
}

// JWT token configuration for temporary session data
const JWT_SECRET = process.env.NEXTAUTH_SECRET || "";
const JWT_EXPIRY = "2m"; // short-lived: the completion redirect is immediate
const SAML_COMPLETE_PREFIX = "saml:complete:";
const SAML_COMPLETE_TTL_SECONDS = 120; // mirrors JWT_EXPIRY

export interface TempSessionData {
  userId: string;
  provider: string;
  email: string;
}

/**
 * Mint the short-lived token handed to /api/auth/saml/complete. When Valkey is
 * available the token's jti is registered so it can be consumed exactly once —
 * the token rides in a redirect URL (logs, Referer, history), so single-use
 * closes the replay window that a bare expiry leaves open.
 */
export async function createTempSessionToken(
  data: TempSessionData
): Promise<string> {
  const jti = randomBytes(16).toString("hex");
  if (valkeyConnection) {
    await valkeyConnection.set(
      `${SAML_COMPLETE_PREFIX}${jti}`,
      "1",
      "EX",
      SAML_COMPLETE_TTL_SECONDS
    );
  }
  return jwt.sign(data, JWT_SECRET, { expiresIn: JWT_EXPIRY, jwtid: jti });
}

export function verifyTempSessionToken(token: string): TempSessionData | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TempSessionData;
  } catch {
    return null;
  }
}

/**
 * Verify and consume a completion token. With Valkey the jti is single-use
 * (deleted on first read, so a replay finds nothing and is rejected); without
 * it, the short JWT expiry bounds the window. Returns null if the token is
 * invalid, expired, or already consumed.
 */
export async function consumeTempSessionToken(
  token: string
): Promise<TempSessionData | null> {
  let decoded: TempSessionData & { jti?: string };
  try {
    decoded = jwt.verify(token, JWT_SECRET) as TempSessionData & {
      jti?: string;
    };
  } catch {
    return null;
  }

  if (valkeyConnection) {
    if (!decoded.jti) return null;
    const removed = await valkeyConnection.del(
      `${SAML_COMPLETE_PREFIX}${decoded.jti}`
    );
    if (removed === 0) return null; // already consumed or expired
  }

  return {
    userId: decoded.userId,
    provider: decoded.provider,
    email: decoded.email,
  };
}

// SAML relay state — carries the provider id and post-login destination across
// the IdP round-trip. The IdP echoes RelayState back on its cross-site POST to
// the ACS, where same-site cookies are not sent, so this (not a cookie) is how
// the callback recovers which provider and destination the login belongs to.
export interface SamlRelayData {
  providerId: string;
  callbackUrl: string;
}

const SAML_RELAY_PREFIX = "saml:relay:";
const SAML_RELAY_TTL_SECONDS = 900; // 15 minutes

/**
 * Mint a RelayState value for a SAML AuthnRequest.
 *
 * When Valkey is available the payload is stored server-side under a short,
 * single-use id — this keeps RelayState within SAML's 80-byte guidance and
 * works across pods. Otherwise it falls back to a signed, self-contained token
 * so SAML still works without Valkey (e.g. local dev / minimal self-host).
 */
export async function createSamlRelayState(
  data: SamlRelayData
): Promise<string> {
  if (valkeyConnection) {
    const relayId = randomBytes(24).toString("hex");
    await valkeyConnection.set(
      `${SAML_RELAY_PREFIX}${relayId}`,
      JSON.stringify(data),
      "EX",
      SAML_RELAY_TTL_SECONDS
    );
    return relayId;
  }
  return jwt.sign(data, JWT_SECRET, { expiresIn: "15m" });
}

/**
 * Resolve and consume a RelayState value returned by the IdP. Valkey-backed
 * ids are single-use (deleted on read); signed fallback tokens are validated by
 * signature and expiry. Returns null if the token is unknown, expired, or
 * malformed.
 */
export async function consumeSamlRelayState(
  relayState: string | null | undefined
): Promise<SamlRelayData | null> {
  if (!relayState) return null;

  if (valkeyConnection) {
    const key = `${SAML_RELAY_PREFIX}${relayState}`;
    const raw = await valkeyConnection.get(key);
    if (raw) {
      await valkeyConnection.del(key);
      try {
        const parsed = JSON.parse(raw) as SamlRelayData;
        return parsed?.providerId ? parsed : null;
      } catch {
        return null;
      }
    }
    // Fall through: may be a signed fallback token issued while Valkey was down.
  }

  try {
    const decoded = jwt.verify(relayState, JWT_SECRET) as SamlRelayData;
    return decoded?.providerId
      ? { providerId: decoded.providerId, callbackUrl: decoded.callbackUrl }
      : null;
  } catch {
    return null;
  }
}

// Rate limiting configuration
export interface RateLimitConfig {
  windowMs: number;
  maxAttempts: number;
}

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = { windowMs: 60000, maxAttempts: 5 }
): boolean {
  const now = Date.now();
  const limit = rateLimitStore.get(identifier);

  if (!limit || limit.resetAt < now) {
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return true;
  }

  if (limit.count >= config.maxAttempts) {
    return false;
  }

  limit.count++;
  return true;
}

// Clean up expired rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

// Security headers for SSO responses
export function getSecurityHeaders(): HeadersInit {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none';",
  };
}

// Validate SAML response timestamp
export function validateSAMLTimestamp(
  notBefore?: string,
  notOnOrAfter?: string
): boolean {
  const now = new Date();

  if (notBefore) {
    const notBeforeDate = new Date(notBefore);
    if (now < notBeforeDate) return false;
  }

  if (notOnOrAfter) {
    const notOnOrAfterDate = new Date(notOnOrAfter);
    if (now >= notOnOrAfterDate) return false;
  }

  return true;
}

// Secure cookie options
export function getSecureCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
  path: string;
  maxAge?: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}
