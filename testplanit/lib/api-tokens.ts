/**
 * API Token Utilities
 *
 * Provides secure token generation and verification for API access.
 * Tokens are one-way hashed using SHA-256 for secure storage.
 */

import crypto from "crypto";

// Token prefix for easy identification
const TOKEN_PREFIX = "tpi_";
// Number of random bytes for token (32 bytes = 256 bits of entropy)
const TOKEN_BYTES = 32;

export interface GeneratedToken {
  /** The plaintext token to show to the user (only shown once) */
  plaintext: string;
  /** SHA-256 hash of the token for database storage */
  hash: string;
  /** First 8 characters of the token for display/identification */
  prefix: string;
}

/**
 * Generate a new API token
 *
 * @returns Object containing the plaintext token, its hash, and prefix
 * @example
 * const { plaintext, hash, prefix } = generateApiToken();
 * // plaintext: "tpi_abc123..." (show to user once)
 * // hash: "sha256hash..." (store in database)
 * // prefix: "tpi_abc1" (for display)
 */
export function generateApiToken(): GeneratedToken {
  // Generate cryptographically secure random bytes
  const randomPart = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const plaintext = `${TOKEN_PREFIX}${randomPart}`;

  // Hash the token for storage
  const hash = hashToken(plaintext);

  // Keep first 8 characters of plaintext for identification
  const prefix = plaintext.substring(0, 12);

  return { plaintext, hash, prefix };
}

/**
 * Hash a token using SHA-256
 *
 * @param token - The plaintext token to hash
 * @returns The SHA-256 hash of the token
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Verify a plaintext token against a stored hash
 *
 * @param plaintext - The plaintext token provided by the user
 * @param storedHash - The hash stored in the database
 * @returns True if the token matches the hash
 */
export function verifyToken(plaintext: string, storedHash: string): boolean {
  const computedHash = hashToken(plaintext);
  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedHash, "hex"),
      Buffer.from(storedHash, "hex")
    );
  } catch {
    // If buffers are different lengths, they don't match
    return false;
  }
}

/**
 * Check if a string looks like a valid API token format
 *
 * @param token - The string to check
 * @returns True if the string has the correct format
 */
export function isValidTokenFormat(token: string): boolean {
  // Token should start with prefix and have sufficient length
  return (
    typeof token === "string" &&
    token.startsWith(TOKEN_PREFIX) &&
    token.length >= TOKEN_PREFIX.length + 20 // Minimum reasonable length
  );
}

/**
 * Mask a token for safe display (show only prefix)
 *
 * @param tokenPrefix - The stored token prefix
 * @returns A masked representation like "tpi_abc1****"
 */
export function maskToken(tokenPrefix: string): string {
  return `${tokenPrefix}${"*".repeat(8)}`;
}
