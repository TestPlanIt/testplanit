import crypto from "crypto";

/**
 * Generates a cryptographically secure share key for share links
 * @returns A URL-safe base64 encoded string with 256 bits of entropy
 */
export function generateShareKey(): string {
  // 32 bytes = 256 bits of entropy
  // base64url encoding for URL-safe characters (no +, /, or =)
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Validates that a share key has the correct format
 * @param shareKey - The share key to validate
 * @returns True if the share key is valid, false otherwise
 */
export function isValidShareKey(shareKey: string): boolean {
  // base64url characters only, length should be 43 characters for 32 bytes
  const base64urlPattern = /^[A-Za-z0-9_-]{43}$/;
  return base64urlPattern.test(shareKey);
}
