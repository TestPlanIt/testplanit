import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateRandomPassword } from "./randomPassword";

describe("generateRandomPassword", () => {
  describe("length", () => {
    it("should generate a password of default length (16) when no length specified", () => {
      const password = generateRandomPassword();
      expect(password.length).toBe(16);
    });

    it("should generate a password of specified length", () => {
      const password = generateRandomPassword(20);
      expect(password.length).toBe(20);
    });

    it("should enforce minimum length of 8 characters", () => {
      const password = generateRandomPassword(4);
      expect(password.length).toBe(8);
    });

    it("should handle length exactly at minimum (8)", () => {
      const password = generateRandomPassword(8);
      expect(password.length).toBe(8);
    });

    it("should handle large lengths", () => {
      const password = generateRandomPassword(100);
      expect(password.length).toBe(100);
    });
  });

  describe("character set", () => {
    const CHARSET =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789!@#$%^&*()-_=+";

    it("should only contain characters from the allowed charset", () => {
      const password = generateRandomPassword(100);
      for (const char of password) {
        expect(CHARSET).toContain(char);
      }
    });

    it("should not contain ambiguous characters (I, l, O, 0 for letters)", () => {
      // Generate many passwords to increase chance of catching issues
      for (let i = 0; i < 100; i++) {
        const password = generateRandomPassword(50);
        // Note: 0 is in the charset but I, l, O are excluded for readability
        expect(password).not.toMatch(/[IlO]/);
      }
    });
  });

  describe("randomness", () => {
    it("should generate unique passwords on each call", () => {
      const passwords = new Set<string>();
      for (let i = 0; i < 100; i++) {
        passwords.add(generateRandomPassword(32));
      }
      // All 100 passwords should be unique
      expect(passwords.size).toBe(100);
    });

    it("should have reasonable character distribution", () => {
      // Generate a long password and check distribution
      const password = generateRandomPassword(1000);
      const charCounts = new Map<string, number>();

      for (const char of password) {
        charCounts.set(char, (charCounts.get(char) || 0) + 1);
      }

      // With 74 characters in charset and 1000 chars, expect ~13.5 per char
      // Allow significant variance for randomness, but no char should dominate
      for (const [, count] of charCounts) {
        expect(count).toBeLessThan(100); // No char should appear more than 10% of time
      }
    });
  });

  describe("edge cases", () => {
    it("should handle zero length by using minimum", () => {
      const password = generateRandomPassword(0);
      expect(password.length).toBe(8);
    });

    it("should handle negative length by using minimum", () => {
      const password = generateRandomPassword(-5);
      expect(password.length).toBe(8);
    });
  });

  describe("crypto API fallback", () => {
    it("should work when crypto.getRandomValues is available", () => {
      // This is the default behavior in Node.js environment
      const password = generateRandomPassword(16);
      expect(password.length).toBe(16);
    });

    it("should work when crypto.getRandomValues is not available", () => {
      // Save original
      const originalCrypto = globalThis.crypto;

      // Mock crypto as undefined
      Object.defineProperty(globalThis, "crypto", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const password = generateRandomPassword(16);
      expect(password.length).toBe(16);

      // Restore
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        writable: true,
        configurable: true,
      });
    });

    it("should work when crypto exists but getRandomValues is undefined", () => {
      // Save original
      const originalCrypto = globalThis.crypto;

      // Mock crypto without getRandomValues
      Object.defineProperty(globalThis, "crypto", {
        value: {},
        writable: true,
        configurable: true,
      });

      const password = generateRandomPassword(16);
      expect(password.length).toBe(16);

      // Restore
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        writable: true,
        configurable: true,
      });
    });
  });
});
