import crypto from "crypto";

const algorithm = "aes-256-gcm";
const ivLength = 16;
const saltLength = 32;
const tagLength = 16;
const iterations = 100000;
const keyLength = 32;

// Get encryption key from environment variable or generate a default one for development
export const getMasterKey = (): string => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // In development, use a default key (DO NOT use in production)
    console.warn("ENCRYPTION_KEY not set, using default key for development");
    return "development-key-do-not-use-in-production-please!";
  }
  return key;
};

// Alias for backward compatibility
const getEncryptionKey = getMasterKey;

// Derive key from password using PBKDF2
const deriveKey = (password: string, salt: Buffer): Buffer => {
  return crypto.pbkdf2Sync(password, salt, iterations, keyLength, "sha256");
};

// Encrypt a value
export const encrypt = async (text: string): Promise<string> => {
  try {
    const password = getEncryptionKey();
    const salt = crypto.randomBytes(saltLength);
    const key = deriveKey(password, salt);
    const iv = crypto.randomBytes(ivLength);

    const cipher = crypto.createCipheriv(algorithm, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    // Combine salt, iv, tag, and encrypted data
    const combined = Buffer.concat([salt, iv, tag, encrypted]);

    return combined.toString("base64");
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
};

// Decrypt a value
export const decrypt = async (encryptedText: string): Promise<string> => {
  try {
    const password = getEncryptionKey();
    const combined = Buffer.from(encryptedText, "base64");

    // Extract components
    const salt = combined.slice(0, saltLength);
    const iv = combined.slice(saltLength, saltLength + ivLength);
    const tag = combined.slice(
      saltLength + ivLength,
      saltLength + ivLength + tagLength
    );
    const encrypted = combined.slice(saltLength + ivLength + tagLength);

    const key = deriveKey(password, salt);

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error("Failed to decrypt data");
  }
};

// Utility to check if a string is encrypted (base64 format check)
export const isEncrypted = (value: string): boolean => {
  try {
    const decoded = Buffer.from(value, "base64");
    // Check if the decoded buffer has the expected minimum length
    return decoded.length >= saltLength + ivLength + tagLength;
  } catch {
    return false;
  }
};

// EncryptionService class for object encryption/decryption
export class EncryptionService {
  static encrypt(text: string, key: string): string {
    const salt = crypto.randomBytes(saltLength);
    const derivedKey = deriveKey(key, salt);
    const iv = crypto.randomBytes(ivLength);

    const cipher = crypto.createCipheriv(algorithm, derivedKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(text, "utf8"),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    // Combine salt, iv, tag, and encrypted data
    const combined = Buffer.concat([salt, iv, tag, encrypted]);

    return combined.toString("base64");
  }

  static decrypt(encryptedText: string, key: string): string {
    const combined = Buffer.from(encryptedText, "base64");

    // Extract components
    const salt = combined.slice(0, saltLength);
    const iv = combined.slice(saltLength, saltLength + ivLength);
    const tag = combined.slice(
      saltLength + ivLength,
      saltLength + ivLength + tagLength
    );
    const encrypted = combined.slice(saltLength + ivLength + tagLength);

    const derivedKey = deriveKey(key, salt);

    const decipher = crypto.createDecipheriv(algorithm, derivedKey, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }

  static encryptObject(obj: any, key: string): string {
    return this.encrypt(JSON.stringify(obj), key);
  }

  static decryptObject(encryptedText: string, key: string): any {
    return JSON.parse(this.decrypt(encryptedText, key));
  }
}
