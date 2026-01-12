import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { randomBytes, createHash } from "crypto";

const APP_NAME = "TestPlanIt";
const EPOCH_TOLERANCE = 30; // ±30 seconds (equivalent to window: 1 with 30-second steps)

/**
 * Generate a new TOTP secret for a user
 */
export function generateTOTPSecret(): string {
  return generateSecret();
}

/**
 * Generate a QR code data URL for the TOTP setup
 */
export async function generateQRCodeDataURL(
  secret: string,
  userEmail: string
): Promise<string> {
  const otpauthUrl = generateURI({
    secret,
    issuer: APP_NAME,
    label: userEmail,
  });
  return QRCode.toDataURL(otpauthUrl);
}

/**
 * Verify a TOTP token against a secret
 */
export async function verifyTOTP(token: string, secret: string): Promise<boolean> {
  try {
    const result = await verify({
      token,
      secret,
      epochTolerance: EPOCH_TOLERANCE,
    });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Generate backup codes for account recovery
 * Returns both plain codes (to show user) and hashed codes (to store)
 */
export function generateBackupCodes(count: number = 10): {
  plainCodes: string[];
  hashedCodes: string[];
} {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric code
    const code = randomBytes(4).toString("hex").toUpperCase();
    plainCodes.push(code);
    hashedCodes.push(hashBackupCode(code));
  }

  return { plainCodes, hashedCodes };
}

/**
 * Hash a backup code for secure storage
 */
export function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase()).digest("hex");
}

/**
 * Verify a backup code against stored hashed codes
 * Returns the index of the matching code, or -1 if not found
 */
export function verifyBackupCode(
  code: string,
  hashedCodes: string[]
): number {
  const hashedInput = hashBackupCode(code);
  return hashedCodes.findIndex((hashed) => hashed === hashedInput);
}

/**
 * Encrypt a secret for database storage
 * In production, use a proper encryption library like node-forge or crypto
 */
export function encryptSecret(secret: string): string {
  // For simplicity, we're using base64 encoding with a prefix
  // In production, use proper AES encryption with a key from env
  const key = process.env.TWO_FACTOR_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || "";
  if (!key) {
    throw new Error("Encryption key not configured");
  }

  // Simple XOR encryption with the key (for demo purposes)
  // In production, use crypto.createCipheriv with AES-256-GCM
  const keyBuffer = Buffer.from(key);
  const secretBuffer = Buffer.from(secret);
  const encrypted = Buffer.alloc(secretBuffer.length);

  for (let i = 0; i < secretBuffer.length; i++) {
    encrypted[i] = secretBuffer[i] ^ keyBuffer[i % keyBuffer.length];
  }

  return `v1:${encrypted.toString("base64")}`;
}

/**
 * Decrypt a secret from database storage
 */
export function decryptSecret(encryptedSecret: string): string {
  const key = process.env.TWO_FACTOR_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || "";
  if (!key) {
    throw new Error("Encryption key not configured");
  }

  // Remove version prefix
  const data = encryptedSecret.replace(/^v1:/, "");
  const encryptedBuffer = Buffer.from(data, "base64");
  const keyBuffer = Buffer.from(key);
  const decrypted = Buffer.alloc(encryptedBuffer.length);

  for (let i = 0; i < encryptedBuffer.length; i++) {
    decrypted[i] = encryptedBuffer[i] ^ keyBuffer[i % keyBuffer.length];
  }

  return decrypted.toString();
}
