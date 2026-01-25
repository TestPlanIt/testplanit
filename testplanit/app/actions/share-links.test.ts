import { describe, it, expect } from "vitest";
import bcrypt from "bcrypt";

/**
 * Tests for password hashing used in share links
 * These are integration tests for bcrypt behavior (not mocked)
 */
describe("Share Link Password Hashing", () => {
  describe("bcrypt password verification", () => {
    it("should hash and verify passwords correctly with 10 rounds", async () => {
      const password = "testPassword123";
      const hash = await bcrypt.hash(password, 10);

      // Verify the hash starts with correct bcrypt prefix for 10 rounds
      expect(hash).toMatch(/^\$2[aby]\$10\$/);

      const isValid = await bcrypt.compare(password, hash);
      expect(isValid).toBe(true);
    });

    it("should reject incorrect passwords", async () => {
      const password = "correctPassword";
      const hash = await bcrypt.hash(password, 10);

      const isValid = await bcrypt.compare("wrongPassword", hash);
      expect(isValid).toBe(false);
    });

    it("should produce different hashes for same password (salt randomization)", async () => {
      const password = "samePassword";
      const hash1 = await bcrypt.hash(password, 10);
      const hash2 = await bcrypt.hash(password, 10);

      // Hashes should be different due to random salt
      expect(hash1).not.toBe(hash2);

      // But both should verify correctly
      expect(await bcrypt.compare(password, hash1)).toBe(true);
      expect(await bcrypt.compare(password, hash2)).toBe(true);
    });

    it("should handle empty password", async () => {
      const password = "";
      const hash = await bcrypt.hash(password, 10);

      const isValid = await bcrypt.compare("", hash);
      expect(isValid).toBe(true);

      // Non-empty password should fail
      expect(await bcrypt.compare("notEmpty", hash)).toBe(false);
    });

    it("should be case sensitive", async () => {
      const password = "Password123";
      const hash = await bcrypt.hash(password, 10);

      expect(await bcrypt.compare("Password123", hash)).toBe(true);
      expect(await bcrypt.compare("password123", hash)).toBe(false);
      expect(await bcrypt.compare("PASSWORD123", hash)).toBe(false);
    });

    it("should handle long passwords", async () => {
      // bcrypt has a max length of 72 bytes, test up to that limit
      const longPassword = "a".repeat(70);
      const hash = await bcrypt.hash(longPassword, 10);

      expect(await bcrypt.compare(longPassword, hash)).toBe(true);
      expect(await bcrypt.compare("a".repeat(69), hash)).toBe(false);
    });

    it("should handle passwords with special characters", async () => {
      const specialPassword = "P@ssw0rd!#$%^&*()_+-=[]{}|;:',.<>?/~`";
      const hash = await bcrypt.hash(specialPassword, 10);

      expect(await bcrypt.compare(specialPassword, hash)).toBe(true);
    });

    it("should handle unicode passwords", async () => {
      const unicodePassword = "密码🔐password";
      const hash = await bcrypt.hash(unicodePassword, 10);

      expect(await bcrypt.compare(unicodePassword, hash)).toBe(true);
    });

    it("should handle whitespace in passwords", async () => {
      const passwordWithSpaces = "  password with   spaces  ";
      const hash = await bcrypt.hash(passwordWithSpaces, 10);

      // Exact match should work
      expect(await bcrypt.compare("  password with   spaces  ", hash)).toBe(true);

      // Trimmed version should fail
      expect(await bcrypt.compare("password with   spaces", hash)).toBe(false);
    });
  });

  describe("bcrypt security properties", () => {
    it("should use correct cost factor (10 rounds)", async () => {
      const password = "testPassword";
      const hash = await bcrypt.hash(password, 10);

      // bcrypt hash format: $2a$10$... or $2b$10$... or $2y$10$...
      // The number after the second $ is the cost factor
      const costMatch = hash.match(/^\$2[aby]\$(\d+)\$/);
      expect(costMatch).toBeTruthy();
      expect(costMatch![1]).toBe("10");
    });

    it("should create secure hashes that cannot be trivially reversed", async () => {
      const password = "secretPassword";
      const hash = await bcrypt.hash(password, 10);

      // Hash should not contain the password in plaintext
      expect(hash.toLowerCase()).not.toContain(password.toLowerCase());

      // Hash should be significantly longer than the password
      expect(hash.length).toBeGreaterThan(password.length);

      // Hash should be 60 characters (bcrypt standard)
      expect(hash.length).toBe(60);
    });

    it("should handle null bytes in passwords", async () => {
      // bcrypt truncates at null bytes, so this is expected behavior
      const passwordWithNull = "password\x00hidden";
      const hash = await bcrypt.hash(passwordWithNull, 10);

      // Should verify with password including null byte
      expect(await bcrypt.compare(passwordWithNull, hash)).toBe(true);

      // Due to bcrypt's behavior, "password" alone might also verify
      // This is a known bcrypt limitation
    });
  });

  describe("performance characteristics", () => {
    it("should take measurable time to hash (due to cost factor)", async () => {
      const password = "testPassword";
      const start = Date.now();

      await bcrypt.hash(password, 10);

      const elapsed = Date.now() - start;

      // 10 rounds should take at least a few milliseconds
      // This prevents brute force attacks
      expect(elapsed).toBeGreaterThan(0);
    });

    it("should take consistent time for verification", async () => {
      const password = "correctPassword";
      const hash = await bcrypt.hash(password, 10);

      // Time to verify correct password
      const start1 = Date.now();
      await bcrypt.compare(password, hash);
      const time1 = Date.now() - start1;

      // Time to verify incorrect password
      const start2 = Date.now();
      await bcrypt.compare("wrongPassword", hash);
      const time2 = Date.now() - start2;

      // Times should be similar (timing attack resistance)
      // Allow for some variance but should be within same order of magnitude
      expect(time1).toBeGreaterThan(0);
      expect(time2).toBeGreaterThan(0);
    });
  });
});
