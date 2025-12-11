/**
 * API Token Utilities
 *
 * Provides secure token generation and verification for API access.
 * Tokens are hashed using HMAC-SHA256 with a server-side secret for secure storage.
 *
 * Security design:
 * - Tokens are generated with 256 bits of cryptographic randomness
 * - HMAC-SHA256 is used with a server-side secret, providing defense-in-depth
 * - Even if the database is compromised, tokens cannot be verified without the HMAC secret
 * - Timing-safe comparison prevents timing attacks
 */

import crypto from "crypto";

// Token prefix for easy identification
const TOKEN_PREFIX = "tpi_";
// Number of random bytes for token (32 bytes = 256 bits of entropy)
const TOKEN_BYTES = 32;

/**
 * Get the HMAC secret key for token hashing.
 * Falls back to NEXTAUTH_SECRET for backward compatibility.
 */
function getHmacSecret(): string {
  const secret = process.env.API_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "API_TOKEN_SECRET or NEXTAUTH_SECRET environment variable must be set for API token hashing"
    );
  }
  return secret;
}

export interface GeneratedToken {
  /** The plaintext token to show to the user (only shown once) */
  plaintext: string;
  /** HMAC-SHA256 hash of the token for database storage */
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
 * Hash a token using HMAC-SHA256 with a server-side secret
 *
 * Using HMAC with a secret provides defense-in-depth:
 * - Even if the database is compromised, attackers cannot verify tokens
 *   without also having access to the HMAC secret
 * - The secret acts as an additional authentication factor
 *
 * @param token - The plaintext token to hash
 * @returns The HMAC-SHA256 hash of the token
 */
export function hashToken(token: string): string {
  const secret = getHmacSecret();
  return crypto.createHmac("sha256", secret).update(token).digest("hex");
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
