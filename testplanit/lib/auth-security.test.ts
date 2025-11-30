import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateSecureState,
  verifyState,
  generateCSRFToken,
  hashData,
  isValidRedirectUrl,
  sanitizeCallbackUrl,
  createTempSessionToken,
  verifyTempSessionToken,
  checkRateLimit,
  getSecurityHeaders,
  validateSAMLTimestamp,
  getSecureCookieOptions,
} from "./auth-security";

// Mock environment variables
const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    NEXTAUTH_URL: "https://app.example.com",
    NEXTAUTH_SECRET: "test-secret-key-at-least-32-chars-long",
  };
});

afterEach(() => {
  process.env = originalEnv;
});

describe("generateSecureState", () => {
  it("should generate a base64url encoded string", () => {
    const state = generateSecureState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("should generate unique values on each call", () => {
    const state1 = generateSecureState();
    const state2 = generateSecureState();
    expect(state1).not.toBe(state2);
  });

  it("should generate a string of consistent length (32 bytes = ~43 chars in base64url)", () => {
    const state = generateSecureState();
    expect(state.length).toBeGreaterThanOrEqual(40);
    expect(state.length).toBeLessThanOrEqual(45);
  });
});

describe("verifyState", () => {
  it("should return true when states match", () => {
    const state = "test-state-123";
    expect(verifyState(state, state)).toBe(true);
  });

  it("should return false when states do not match", () => {
    expect(verifyState("state-1", "state-2")).toBe(false);
  });

  it("should return false when storedState is undefined", () => {
    expect(verifyState(undefined, "some-state")).toBe(false);
  });

  it("should return false when receivedState is undefined", () => {
    expect(verifyState("some-state", undefined)).toBe(false);
  });

  it("should return false when both states are undefined", () => {
    expect(verifyState(undefined, undefined)).toBe(false);
  });

  it("should return false for empty strings", () => {
    expect(verifyState("", "")).toBe(false);
  });
});

describe("generateCSRFToken", () => {
  it("should generate a hex encoded string", () => {
    const token = generateCSRFToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("should generate a 64 character hex string (32 bytes)", () => {
    const token = generateCSRFToken();
    expect(token.length).toBe(64);
  });

  it("should generate unique tokens on each call", () => {
    const token1 = generateCSRFToken();
    const token2 = generateCSRFToken();
    expect(token1).not.toBe(token2);
  });
});

describe("hashData", () => {
  it("should return a SHA-256 hex hash", () => {
    const hash = hashData("test-data");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should be deterministic (same input yields same hash)", () => {
    const hash1 = hashData("test-data");
    const hash2 = hashData("test-data");
    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different inputs", () => {
    const hash1 = hashData("data-1");
    const hash2 = hashData("data-2");
    expect(hash1).not.toBe(hash2);
  });

  it("should handle empty string input", () => {
    const hash = hashData("");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isValidRedirectUrl", () => {
  it("should return true for relative URLs starting with /", () => {
    expect(isValidRedirectUrl("/dashboard")).toBe(true);
    expect(isValidRedirectUrl("/settings/profile")).toBe(true);
  });

  it("should return false for protocol-relative URLs (//)", () => {
    expect(isValidRedirectUrl("//evil.com")).toBe(false);
  });

  it("should return true for same-origin absolute URLs", () => {
    expect(isValidRedirectUrl("https://app.example.com/dashboard")).toBe(true);
  });

  it("should return false for different-origin URLs", () => {
    expect(isValidRedirectUrl("https://evil.com/phishing")).toBe(false);
  });

  it("should return false for invalid URLs", () => {
    expect(isValidRedirectUrl("javascript:alert(1)")).toBe(false);
  });

  it("should return false for data URLs", () => {
    expect(isValidRedirectUrl("data:text/html,<script>")).toBe(false);
  });
});

describe("sanitizeCallbackUrl", () => {
  it("should return / for null input", () => {
    expect(sanitizeCallbackUrl(null)).toBe("/");
  });

  it("should return / for undefined input", () => {
    expect(sanitizeCallbackUrl(undefined)).toBe("/");
  });

  it("should return / for empty string", () => {
    expect(sanitizeCallbackUrl("")).toBe("/");
  });

  it("should return valid relative URLs unchanged", () => {
    expect(sanitizeCallbackUrl("/dashboard")).toBe("/dashboard");
  });

  it("should return / for invalid redirect URLs", () => {
    expect(sanitizeCallbackUrl("https://evil.com")).toBe("/");
  });
});

describe("createTempSessionToken and verifyTempSessionToken", () => {
  const testData = {
    userId: "user-123",
    provider: "google",
    email: "test@example.com",
  };

  // Note: These tests require NEXTAUTH_SECRET to be set at module load time.
  // The module uses a const JWT_SECRET = process.env.NEXTAUTH_SECRET || ""
  // which is evaluated when the module is first imported.
  // In a real environment, this would be set. For tests, we test the error case
  // and use dynamic imports for success cases.

  it("should create a valid JWT token when secret is available", async () => {
    // Use dynamic import with env set before import
    const originalSecret = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";

    // Force module re-evaluation by clearing cache
    vi.resetModules();
    const { createTempSessionToken: createToken } = await import(
      "./auth-security"
    );

    const token = createToken(testData);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // JWT has 3 parts

    process.env.NEXTAUTH_SECRET = originalSecret;
  });

  it("should verify and return the original data", async () => {
    const originalSecret = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";

    vi.resetModules();
    const {
      createTempSessionToken: createToken,
      verifyTempSessionToken: verifyToken,
    } = await import("./auth-security");

    const token = createToken(testData);
    const verified = verifyToken(token);

    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(testData.userId);
    expect(verified?.provider).toBe(testData.provider);
    expect(verified?.email).toBe(testData.email);

    process.env.NEXTAUTH_SECRET = originalSecret;
  });

  it("should return null for invalid tokens", () => {
    const result = verifyTempSessionToken("invalid-token");
    expect(result).toBeNull();
  });

  it("should return null for tampered tokens", async () => {
    const originalSecret = process.env.NEXTAUTH_SECRET;
    process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";

    vi.resetModules();
    const { createTempSessionToken: createToken, verifyTempSessionToken: verifyToken } =
      await import("./auth-security");

    const token = createToken(testData);
    const tamperedToken = token.slice(0, -5) + "xxxxx";
    const result = verifyToken(tamperedToken);
    expect(result).toBeNull();

    process.env.NEXTAUTH_SECRET = originalSecret;
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    // Clear rate limit store between tests by using unique identifiers
  });

  it("should allow first request", () => {
    const identifier = `test-${Date.now()}-1`;
    expect(checkRateLimit(identifier)).toBe(true);
  });

  it("should allow requests up to maxAttempts", () => {
    const identifier = `test-${Date.now()}-2`;
    const config = { windowMs: 60000, maxAttempts: 3 };

    expect(checkRateLimit(identifier, config)).toBe(true);
    expect(checkRateLimit(identifier, config)).toBe(true);
    expect(checkRateLimit(identifier, config)).toBe(true);
  });

  it("should block requests after maxAttempts", () => {
    const identifier = `test-${Date.now()}-3`;
    const config = { windowMs: 60000, maxAttempts: 2 };

    expect(checkRateLimit(identifier, config)).toBe(true);
    expect(checkRateLimit(identifier, config)).toBe(true);
    expect(checkRateLimit(identifier, config)).toBe(false);
  });

  it("should use default config when not provided", () => {
    const identifier = `test-${Date.now()}-4`;
    // Default is 5 attempts
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(identifier)).toBe(true);
    }
    expect(checkRateLimit(identifier)).toBe(false);
  });
});

describe("getSecurityHeaders", () => {
  it("should return required security headers", () => {
    const headers = getSecurityHeaders();

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-XSS-Protection"]).toBe("1; mode=block");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'"
    );
  });
});

describe("validateSAMLTimestamp", () => {
  it("should return true when no timestamps provided", () => {
    expect(validateSAMLTimestamp()).toBe(true);
  });

  it("should return true when current time is after notBefore", () => {
    const pastDate = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
    expect(validateSAMLTimestamp(pastDate)).toBe(true);
  });

  it("should return false when current time is before notBefore", () => {
    const futureDate = new Date(Date.now() + 60000).toISOString(); // 1 minute from now
    expect(validateSAMLTimestamp(futureDate)).toBe(false);
  });

  it("should return true when current time is before notOnOrAfter", () => {
    const futureDate = new Date(Date.now() + 60000).toISOString();
    expect(validateSAMLTimestamp(undefined, futureDate)).toBe(true);
  });

  it("should return false when current time is at or after notOnOrAfter", () => {
    const pastDate = new Date(Date.now() - 60000).toISOString();
    expect(validateSAMLTimestamp(undefined, pastDate)).toBe(false);
  });

  it("should validate both timestamps together", () => {
    const pastDate = new Date(Date.now() - 60000).toISOString();
    const futureDate = new Date(Date.now() + 60000).toISOString();
    expect(validateSAMLTimestamp(pastDate, futureDate)).toBe(true);
  });

  it("should return false when window has expired", () => {
    const pastDate1 = new Date(Date.now() - 120000).toISOString(); // 2 minutes ago
    const pastDate2 = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
    expect(validateSAMLTimestamp(pastDate1, pastDate2)).toBe(false);
  });
});

describe("getSecureCookieOptions", () => {
  it("should return httpOnly as true", () => {
    const options = getSecureCookieOptions();
    expect(options.httpOnly).toBe(true);
  });

  it("should return sameSite as lax", () => {
    const options = getSecureCookieOptions();
    expect(options.sameSite).toBe("lax");
  });

  it("should return path as /", () => {
    const options = getSecureCookieOptions();
    expect(options.path).toBe("/");
  });

  it("should set secure based on NODE_ENV", () => {
    const originalNodeEnv = process.env.NODE_ENV;

    process.env.NODE_ENV = "production";
    expect(getSecureCookieOptions().secure).toBe(true);

    process.env.NODE_ENV = "development";
    expect(getSecureCookieOptions().secure).toBe(false);

    process.env.NODE_ENV = originalNodeEnv;
  });
});
