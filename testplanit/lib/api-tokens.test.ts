import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  generateApiToken,
  hashToken,
  verifyToken,
  isValidTokenFormat,
  maskToken,
} from "./api-tokens";

describe("API Token Utilities", () => {
  // Set up test secret for HMAC hashing
  const originalSecret = process.env.NEXTAUTH_SECRET;

  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-api-token-hashing";
  });

  afterAll(() => {
    if (originalSecret) {
      process.env.NEXTAUTH_SECRET = originalSecret;
    } else {
      delete process.env.NEXTAUTH_SECRET;
    }
  });
  describe("generateApiToken", () => {
    it("generates a token with the correct prefix", () => {
      const { plaintext } = generateApiToken();
      expect(plaintext).toMatch(/^tpi_/);
    });

    it("generates unique tokens each time", () => {
      const token1 = generateApiToken();
      const token2 = generateApiToken();

      expect(token1.plaintext).not.toBe(token2.plaintext);
      expect(token1.hash).not.toBe(token2.hash);
    });

    it("generates tokens with sufficient length", () => {
      const { plaintext } = generateApiToken();
      // tpi_ prefix (4) + base64url encoded 32 bytes (~43 characters)
      expect(plaintext.length).toBeGreaterThan(40);
    });

    it("returns a hash that differs from the plaintext", () => {
      const { plaintext, hash } = generateApiToken();
      expect(hash).not.toBe(plaintext);
    });

    it("returns a prefix that starts with tpi_", () => {
      const { prefix } = generateApiToken();
      expect(prefix).toMatch(/^tpi_/);
      expect(prefix.length).toBe(12); // "tpi_" + 8 chars
    });

    it("returns a prefix that matches the start of plaintext", () => {
      const { plaintext, prefix } = generateApiToken();
      expect(plaintext.startsWith(prefix)).toBe(true);
    });
  });

  describe("hashToken", () => {
    it("produces consistent hashes for the same input", () => {
      const token = "tpi_test_token_123";
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different inputs", () => {
      const hash1 = hashToken("tpi_token_a");
      const hash2 = hashToken("tpi_token_b");

      expect(hash1).not.toBe(hash2);
    });

    it("produces a 64-character hex string (SHA-256)", () => {
      const hash = hashToken("tpi_any_token");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("verifyToken", () => {
    it("returns true for matching token and hash", () => {
      const { plaintext, hash } = generateApiToken();
      expect(verifyToken(plaintext, hash)).toBe(true);
    });

    it("returns false for non-matching token", () => {
      const { hash } = generateApiToken();
      const wrongToken = "tpi_wrong_token";
      expect(verifyToken(wrongToken, hash)).toBe(false);
    });

    it("returns false for empty token", () => {
      const { hash } = generateApiToken();
      expect(verifyToken("", hash)).toBe(false);
    });

    it("returns false for malformed hash", () => {
      const { plaintext } = generateApiToken();
      expect(verifyToken(plaintext, "invalid_hash")).toBe(false);
    });

    it("handles timing-safe comparison correctly", () => {
      const { plaintext, hash } = generateApiToken();
      // Slightly modified token should still fail securely
      const modifiedToken = plaintext.slice(0, -1) + "x";
      expect(verifyToken(modifiedToken, hash)).toBe(false);
    });
  });

  describe("isValidTokenFormat", () => {
    it("returns true for valid token format", () => {
      const { plaintext } = generateApiToken();
      expect(isValidTokenFormat(plaintext)).toBe(true);
    });

    it("returns true for minimum valid token", () => {
      // tpi_ + 20 characters minimum
      const minToken = "tpi_" + "a".repeat(20);
      expect(isValidTokenFormat(minToken)).toBe(true);
    });

    it("returns false for token without prefix", () => {
      expect(isValidTokenFormat("invalid_token_without_prefix")).toBe(false);
    });

    it("returns false for token that is too short", () => {
      expect(isValidTokenFormat("tpi_short")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isValidTokenFormat("")).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(isValidTokenFormat(null as any)).toBe(false);
      expect(isValidTokenFormat(undefined as any)).toBe(false);
    });

    it("returns false for non-string values", () => {
      expect(isValidTokenFormat(123 as any)).toBe(false);
      expect(isValidTokenFormat({} as any)).toBe(false);
    });
  });

  describe("maskToken", () => {
    it("appends asterisks to the prefix", () => {
      const masked = maskToken("tpi_abc12345");
      expect(masked).toBe("tpi_abc12345********");
    });

    it("handles empty prefix", () => {
      const masked = maskToken("");
      expect(masked).toBe("********");
    });

    it("always adds exactly 8 asterisks", () => {
      const masked = maskToken("tpi_test");
      expect(masked.endsWith("********")).toBe(true);
    });
  });
});
