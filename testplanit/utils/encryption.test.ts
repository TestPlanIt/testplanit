import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getMasterKey,
  encrypt,
  decrypt,
  isEncrypted,
  EncryptionService,
} from "./encryption";

// Mock environment variables
const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe("getMasterKey", () => {
  it("should return the ENCRYPTION_KEY when set", () => {
    process.env.ENCRYPTION_KEY = "my-secure-encryption-key";
    // Need to re-import to get fresh module
    expect(getMasterKey()).toBe("my-secure-encryption-key");
  });

  it("should return default development key when ENCRYPTION_KEY is not set", () => {
    delete process.env.ENCRYPTION_KEY;
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const key = getMasterKey();
    expect(key).toBe("development-key-do-not-use-in-production-please!");
    expect(consoleSpy).toHaveBeenCalledWith(
      "ENCRYPTION_KEY not set, using default key for development"
    );
    consoleSpy.mockRestore();
  });
});

describe("encrypt and decrypt", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  it("should encrypt a string and return base64 encoded result", async () => {
    const plaintext = "Hello, World!";
    const encrypted = await encrypt(plaintext);

    expect(typeof encrypted).toBe("string");
    // Should be valid base64
    expect(() => Buffer.from(encrypted, "base64")).not.toThrow();
  });

  it("should produce different ciphertext for same plaintext (due to random salt/iv)", async () => {
    const plaintext = "Same text";
    const encrypted1 = await encrypt(plaintext);
    const encrypted2 = await encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
  });

  it("should decrypt an encrypted string back to original", async () => {
    const plaintext = "Secret message 123!";
    const encrypted = await encrypt(plaintext);
    const decrypted = await decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("should handle empty string", async () => {
    const plaintext = "";
    const encrypted = await encrypt(plaintext);
    const decrypted = await decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("should handle unicode characters", async () => {
    const plaintext = "Hello 世界 🔐";
    const encrypted = await encrypt(plaintext);
    const decrypted = await decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("should handle long strings", async () => {
    const plaintext = "A".repeat(10000);
    const encrypted = await encrypt(plaintext);
    const decrypted = await decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("should throw error when decrypting invalid data", async () => {
    await expect(decrypt("invalid-not-base64!@#")).rejects.toThrow(
      "Failed to decrypt data"
    );
  });

  it("should throw error when decrypting tampered data", async () => {
    const encrypted = await encrypt("test");
    const tampered = encrypted.slice(0, -5) + "XXXXX";

    await expect(decrypt(tampered)).rejects.toThrow("Failed to decrypt data");
  });
});

describe("isEncrypted", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-testing-purposes";
  });

  it("should return true for encrypted values", async () => {
    const encrypted = await encrypt("test data");
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it("should return false for plain text", () => {
    expect(isEncrypted("plain text")).toBe(false);
  });

  it("should return false for short base64 strings", () => {
    // Minimum length is saltLength + ivLength + tagLength = 32 + 16 + 16 = 64 bytes
    const shortBase64 = Buffer.from("short").toString("base64");
    expect(isEncrypted(shortBase64)).toBe(false);
  });

  it("should return true for base64 strings meeting minimum length", () => {
    // Create a buffer of exactly the minimum length
    const minLength = 32 + 16 + 16; // salt + iv + tag
    const longEnough = Buffer.alloc(minLength).toString("base64");
    expect(isEncrypted(longEnough)).toBe(true);
  });

  it("should return false for invalid base64", () => {
    expect(isEncrypted("not!valid@base64#string")).toBe(false);
  });
});

describe("EncryptionService", () => {
  const testKey = "test-service-encryption-key-32chars!";

  describe("encrypt and decrypt", () => {
    it("should encrypt and decrypt a string", () => {
      const plaintext = "Service test message";
      const encrypted = EncryptionService.encrypt(plaintext, testKey);
      const decrypted = EncryptionService.decrypt(encrypted, testKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertext for same plaintext", () => {
      const plaintext = "Same message";
      const encrypted1 = EncryptionService.encrypt(plaintext, testKey);
      const encrypted2 = EncryptionService.encrypt(plaintext, testKey);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it("should fail to decrypt with wrong key", () => {
      const plaintext = "Secret";
      const encrypted = EncryptionService.encrypt(plaintext, testKey);

      expect(() =>
        EncryptionService.decrypt(encrypted, "wrong-key-wrong-key-wrong-key!!")
      ).toThrow();
    });

    it("should handle unicode characters", () => {
      const plaintext = "Unicode: 日本語 🎉";
      const encrypted = EncryptionService.encrypt(plaintext, testKey);
      const decrypted = EncryptionService.decrypt(encrypted, testKey);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe("encryptObject and decryptObject", () => {
    it("should encrypt and decrypt an object", () => {
      const obj = { name: "Test", value: 123, nested: { key: "value" } };
      const encrypted = EncryptionService.encryptObject(obj, testKey);
      const decrypted = EncryptionService.decryptObject(encrypted, testKey);

      expect(decrypted).toEqual(obj);
    });

    it("should encrypt and decrypt arrays", () => {
      const arr = [1, 2, 3, "four", { five: 5 }];
      const encrypted = EncryptionService.encryptObject(arr, testKey);
      const decrypted = EncryptionService.decryptObject(encrypted, testKey);

      expect(decrypted).toEqual(arr);
    });

    it("should handle null values in objects", () => {
      const obj = { key: null, other: "value" };
      const encrypted = EncryptionService.encryptObject(obj, testKey);
      const decrypted = EncryptionService.decryptObject(encrypted, testKey);

      expect(decrypted).toEqual(obj);
    });

    it("should handle boolean values", () => {
      const obj = { active: true, disabled: false };
      const encrypted = EncryptionService.encryptObject(obj, testKey);
      const decrypted = EncryptionService.decryptObject(encrypted, testKey);

      expect(decrypted).toEqual(obj);
    });

    it("should throw when decrypting invalid JSON", () => {
      const encrypted = EncryptionService.encrypt("not json", testKey);
      expect(() =>
        EncryptionService.decryptObject(encrypted, testKey)
      ).toThrow();
    });
  });
});
