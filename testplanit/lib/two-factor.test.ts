import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateSecret, generate } from "otplib";
import {
  generateTOTPSecret,
  generateQRCodeDataURL,
  verifyTOTP,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  encryptSecret,
  decryptSecret,
} from "./two-factor";

// Mock QRCode
vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,mockQRCode"),
  },
}));

describe("Two-Factor Authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set encryption key for tests
    vi.stubEnv("TWO_FACTOR_ENCRYPTION_KEY", "test-encryption-key-32-chars!!");
    vi.stubEnv("NEXTAUTH_SECRET", "fallback-secret-key");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("generateTOTPSecret", () => {
    it("should generate a valid TOTP secret", () => {
      const secret = generateTOTPSecret();

      expect(secret).toBeDefined();
      expect(typeof secret).toBe("string");
      expect(secret.length).toBeGreaterThan(0);
    });

    it("should generate unique secrets", () => {
      const secret1 = generateTOTPSecret();
      const secret2 = generateTOTPSecret();

      expect(secret1).not.toBe(secret2);
    });

    it("should generate base32 encoded secret", () => {
      const secret = generateTOTPSecret();

      // Base32 only uses A-Z and 2-7
      expect(secret).toMatch(/^[A-Z2-7]+$/);
    });
  });

  describe("generateQRCodeDataURL", () => {
    it("should generate QR code data URL", async () => {
      const secret = "TESTSECRET";
      const email = "test@example.com";

      const qrCode = await generateQRCodeDataURL(secret, email);

      expect(qrCode).toBe("data:image/png;base64,mockQRCode");
    });

    it("should include email in OTP auth URL", async () => {
      const secret = "TESTSECRET";
      const email = "user@example.com";

      await generateQRCodeDataURL(secret, email);

      // The function builds an otpauth URL with the email encoded
      // We verify the QR code was generated (mock was called)
      const QRCode = await import("qrcode");
      expect(QRCode.default.toDataURL).toHaveBeenCalled();
      const calledWith = vi.mocked(QRCode.default.toDataURL).mock.calls[0][0];
      expect(calledWith).toContain(encodeURIComponent("user@example.com"));
    });

    it("should include app name in OTP auth URL", async () => {
      const QRCode = await import("qrcode");
      const secret = "TESTSECRET";
      const email = "test@example.com";

      await generateQRCodeDataURL(secret, email);

      expect(QRCode.default.toDataURL).toHaveBeenCalledWith(
        expect.stringContaining("TestPlanIt")
      );
    });
  });

  describe("verifyTOTP", () => {
    it("should return true for valid token", async () => {
      const secret = generateSecret();
      const token = await generate({ secret });

      const result = await verifyTOTP(token, secret);

      expect(result).toBe(true);
    });

    it("should return false for invalid token", async () => {
      const secret = generateSecret();

      const result = await verifyTOTP("000000", secret);

      expect(result).toBe(false);
    });

    it("should return false for empty token", async () => {
      const secret = generateSecret();

      const result = await verifyTOTP("", secret);

      expect(result).toBe(false);
    });

    it("should return false for null/undefined token", async () => {
      const secret = generateSecret();

      const result = await verifyTOTP(undefined as any, secret);

      expect(result).toBe(false);
    });

    it("should handle malformed token gracefully", async () => {
      const secret = generateSecret();

      const result = await verifyTOTP("not-a-number", secret);

      expect(result).toBe(false);
    });

    it("should handle invalid secret gracefully", async () => {
      const result = await verifyTOTP("123456", "invalid-secret");

      expect(result).toBe(false);
    });
  });

  describe("generateBackupCodes", () => {
    it("should generate 10 backup codes by default", () => {
      const { plainCodes, hashedCodes } = generateBackupCodes();

      expect(plainCodes).toHaveLength(10);
      expect(hashedCodes).toHaveLength(10);
    });

    it("should generate specified number of codes", () => {
      const { plainCodes, hashedCodes } = generateBackupCodes(5);

      expect(plainCodes).toHaveLength(5);
      expect(hashedCodes).toHaveLength(5);
    });

    it("should generate 8-character uppercase codes", () => {
      const { plainCodes } = generateBackupCodes(1);

      expect(plainCodes[0]).toHaveLength(8);
      expect(plainCodes[0]).toMatch(/^[A-F0-9]+$/);
    });

    it("should generate unique codes", () => {
      const { plainCodes } = generateBackupCodes(100);

      const uniqueCodes = new Set(plainCodes);
      expect(uniqueCodes.size).toBe(100);
    });

    it("should hash codes correctly", () => {
      const { plainCodes, hashedCodes } = generateBackupCodes(1);

      const expectedHash = hashBackupCode(plainCodes[0]);
      expect(hashedCodes[0]).toBe(expectedHash);
    });

    it("should generate different codes each time", () => {
      const result1 = generateBackupCodes(1);
      const result2 = generateBackupCodes(1);

      expect(result1.plainCodes[0]).not.toBe(result2.plainCodes[0]);
    });
  });

  describe("hashBackupCode", () => {
    it("should return SHA-256 hash", () => {
      const code = "ABCD1234";
      const hash = hashBackupCode(code);

      expect(hash).toHaveLength(64); // SHA-256 produces 64 hex characters
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it("should be case insensitive", () => {
      const hash1 = hashBackupCode("abcd1234");
      const hash2 = hashBackupCode("ABCD1234");

      expect(hash1).toBe(hash2);
    });

    it("should produce consistent hash", () => {
      const code = "TESTCODE";
      const hash1 = hashBackupCode(code);
      const hash2 = hashBackupCode(code);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different codes", () => {
      const hash1 = hashBackupCode("CODE0001");
      const hash2 = hashBackupCode("CODE0002");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("verifyBackupCode", () => {
    it("should return index when code is found", () => {
      const { plainCodes, hashedCodes } = generateBackupCodes(5);

      const index = verifyBackupCode(plainCodes[2], hashedCodes);

      expect(index).toBe(2);
    });

    it("should return -1 when code is not found", () => {
      const { hashedCodes } = generateBackupCodes(5);

      const index = verifyBackupCode("INVALID!", hashedCodes);

      expect(index).toBe(-1);
    });

    it("should be case insensitive for verification", () => {
      const { plainCodes, hashedCodes } = generateBackupCodes(1);

      const indexUpper = verifyBackupCode(plainCodes[0].toUpperCase(), hashedCodes);
      const indexLower = verifyBackupCode(plainCodes[0].toLowerCase(), hashedCodes);

      expect(indexUpper).toBe(0);
      expect(indexLower).toBe(0);
    });

    it("should return first matching index for duplicates", () => {
      const code = "TESTCODE";
      const hashedCode = hashBackupCode(code);
      const hashedCodes = [hashedCode, hashedCode, hashedCode];

      const index = verifyBackupCode(code, hashedCodes);

      expect(index).toBe(0);
    });

    it("should handle empty hashedCodes array", () => {
      const index = verifyBackupCode("ANYCODE!", []);

      expect(index).toBe(-1);
    });
  });

  describe("encryptSecret", () => {
    it("should encrypt secret with version prefix", () => {
      const secret = "TESTSECRET123456";

      const encrypted = encryptSecret(secret);

      expect(encrypted).toMatch(/^v1:/);
    });

    it("should produce base64 encoded output", () => {
      const secret = "TESTSECRET";

      const encrypted = encryptSecret(secret);
      const base64Part = encrypted.replace(/^v1:/, "");

      expect(() => Buffer.from(base64Part, "base64")).not.toThrow();
    });

    it("should throw error when encryption key not configured", () => {
      vi.unstubAllEnvs();
      vi.stubEnv("TWO_FACTOR_ENCRYPTION_KEY", "");
      vi.stubEnv("NEXTAUTH_SECRET", "");

      expect(() => encryptSecret("secret")).toThrow(
        "Encryption key not configured"
      );
    });

    it("should use NEXTAUTH_SECRET as fallback", () => {
      vi.unstubAllEnvs();
      vi.stubEnv("TWO_FACTOR_ENCRYPTION_KEY", "");
      vi.stubEnv("NEXTAUTH_SECRET", "fallback-key");

      // Should not throw
      expect(() => encryptSecret("secret")).not.toThrow();
    });

    it("should produce different output for different secrets", () => {
      const encrypted1 = encryptSecret("SECRET1");
      const encrypted2 = encryptSecret("SECRET2");

      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should produce consistent output for same secret", () => {
      const secret = "CONSISTENTSECRET";

      const encrypted1 = encryptSecret(secret);
      const encrypted2 = encryptSecret(secret);

      expect(encrypted1).toBe(encrypted2);
    });
  });

  describe("decryptSecret", () => {
    it("should decrypt encrypted secret", () => {
      const originalSecret = "MYTESTSECRET";

      const encrypted = encryptSecret(originalSecret);
      const decrypted = decryptSecret(encrypted);

      expect(decrypted).toBe(originalSecret);
    });

    it("should handle version prefix", () => {
      const originalSecret = "SECRETWITHPREFIX";

      const encrypted = encryptSecret(originalSecret);
      expect(encrypted).toMatch(/^v1:/);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(originalSecret);
    });

    it("should throw error when encryption key not configured", () => {
      vi.unstubAllEnvs();
      vi.stubEnv("TWO_FACTOR_ENCRYPTION_KEY", "");
      vi.stubEnv("NEXTAUTH_SECRET", "");

      expect(() => decryptSecret("v1:encrypted")).toThrow(
        "Encryption key not configured"
      );
    });

    it("should decrypt with same key used for encryption", () => {
      const secret = "ROUNDTRIPSECRET";

      const encrypted = encryptSecret(secret);
      const decrypted = decryptSecret(encrypted);

      expect(decrypted).toBe(secret);
    });

    it("should handle special characters in secret", () => {
      const secret = "SECRET!@#$%^&*()";

      const encrypted = encryptSecret(secret);
      const decrypted = decryptSecret(encrypted);

      expect(decrypted).toBe(secret);
    });

    it("should handle unicode characters", () => {
      const secret = "SECRET🔐🔑";

      const encrypted = encryptSecret(secret);
      const decrypted = decryptSecret(encrypted);

      expect(decrypted).toBe(secret);
    });

    it("should handle long secrets", () => {
      const secret = "A".repeat(1000);

      const encrypted = encryptSecret(secret);
      const decrypted = decryptSecret(encrypted);

      expect(decrypted).toBe(secret);
    });
  });

  describe("Integration", () => {
    it("should complete full 2FA setup and verification flow", async () => {
      // 1. Generate secret
      const secret = generateTOTPSecret();
      expect(secret).toBeDefined();

      // 2. Generate QR code
      const qrCode = await generateQRCodeDataURL(secret, "test@example.com");
      expect(qrCode).toContain("data:image");

      // 3. Encrypt secret for storage
      const encryptedSecret = encryptSecret(secret);
      expect(encryptedSecret).toMatch(/^v1:/);

      // 4. Decrypt secret for verification
      const decryptedSecret = decryptSecret(encryptedSecret);
      expect(decryptedSecret).toBe(secret);

      // 5. Generate and verify token
      const token = await generate({ secret: decryptedSecret });
      const isValid = await verifyTOTP(token, decryptedSecret);
      expect(isValid).toBe(true);
    });

    it("should complete backup code generation and verification", () => {
      // 1. Generate backup codes
      const { plainCodes, hashedCodes } = generateBackupCodes(10);

      // 2. Verify each plain code matches its hash
      for (let i = 0; i < plainCodes.length; i++) {
        const index = verifyBackupCode(plainCodes[i], hashedCodes);
        expect(index).toBe(i);
      }

      // 3. Verify used code can be removed
      const usedCode = plainCodes[5];
      const usedIndex = verifyBackupCode(usedCode, hashedCodes);
      expect(usedIndex).toBe(5);

      // Remove used code
      const remainingCodes = hashedCodes.filter((_, i) => i !== usedIndex);
      expect(remainingCodes).toHaveLength(9);

      // Verify used code no longer works
      const reusedIndex = verifyBackupCode(usedCode, remainingCodes);
      expect(reusedIndex).toBe(-1);
    });
  });
});
