import { randomBytes, createHash } from "crypto";
import jwt from "jsonwebtoken";

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

// JWT token configuration for temporary session data
const JWT_SECRET = process.env.NEXTAUTH_SECRET || "";
const JWT_EXPIRY = "5m"; // 5 minutes for temporary tokens

export interface TempSessionData {
  userId: string;
  provider: string;
  email: string;
}

export function createTempSessionToken(data: TempSessionData): string {
  return jwt.sign(data, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyTempSessionToken(token: string): TempSessionData | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TempSessionData;
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
