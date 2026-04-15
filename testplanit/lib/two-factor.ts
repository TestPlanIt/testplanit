import { createHash, randomBytes } from "crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { EncryptionService, getMasterKey } from "~/utils/encryption";

const APP_NAME = "TestPlanIt";

// Version prefixes for encrypted 2FA secrets stored in the DB:
//   v1: legacy XOR + repeating key (insecure — decrypt-only for migration)
//   v2: AES-256-GCM via EncryptionService, using ENCRYPTION_KEY
const LEGACY_PREFIX = "v1:";
const CURRENT_PREFIX = "v2:";

// The legacy XOR path used its own env var. Keep the resolution logic for
// backward-compatible decryption of existing v1 records; new writes always
// use the shared ENCRYPTION_KEY via getMasterKey().
function getLegacyKey(): string {
  const key = process.env.TWO_FACTOR_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || "";
  if (!key) {
    throw new Error("Encryption key not configured");
  }
  return key;
}

// Configuration options for TOTP
const TOTP_OPTIONS = {
  window: 1, // Allow 1 step before/after for clock drift
};

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
      ...TOTP_OPTIONS,
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
 * Encrypt a TOTP secret for database storage using AES-256-GCM.
 * Writes `v2:` prefixed ciphertext. Legacy `v1:` (XOR) records remain
 * decryptable via decryptSecret for backward compatibility.
 */
export function encryptSecret(secret: string): string {
  const ciphertext = EncryptionService.encrypt(secret, getMasterKey());
  return `${CURRENT_PREFIX}${ciphertext}`;
}

/**
 * Decrypt a TOTP secret from database storage. Transparently handles both
 * the current AES-256-GCM format (`v2:` prefix) and the legacy XOR format
 * (`v1:` prefix) so existing enrollments keep working during the migration
 * window. Check `isLegacyEncryption(s)` after decrypt and re-persist via
 * encryptSecret to upgrade a record in place.
 */
export function decryptSecret(encryptedSecret: string): string {
  if (encryptedSecret.startsWith(CURRENT_PREFIX)) {
    const payload = encryptedSecret.slice(CURRENT_PREFIX.length);
    return EncryptionService.decrypt(payload, getMasterKey());
  }

  if (encryptedSecret.startsWith(LEGACY_PREFIX)) {
    return decryptLegacyV1(encryptedSecret);
  }

  throw new Error("Unknown or missing encrypted-secret version prefix");
}

/**
 * True if the stored secret is still in the legacy XOR format and should
 * be re-encrypted with AES-256-GCM on the next convenient write.
 */
export function isLegacyEncryption(encryptedSecret: string): boolean {
  return encryptedSecret.startsWith(LEGACY_PREFIX);
}

// Legacy XOR decryption path. Retained only so existing `v1:` records keep
// working until they're re-encrypted as `v2:` on next read. Do not add new
// callers — new writes go through encryptSecret (AES-256-GCM).
function decryptLegacyV1(encryptedSecret: string): string {
  const key = getLegacyKey();
  const data = encryptedSecret.slice(LEGACY_PREFIX.length);
  const encryptedBuffer = Buffer.from(data, "base64");
  const keyBuffer = Buffer.from(key);
  const decrypted = Buffer.alloc(encryptedBuffer.length);
  for (let i = 0; i < encryptedBuffer.length; i++) {
    decrypted[i] = encryptedBuffer[i] ^ keyBuffer[i % keyBuffer.length];
  }
  return decrypted.toString();
}
