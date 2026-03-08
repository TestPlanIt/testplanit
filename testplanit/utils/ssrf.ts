// Private IP ranges that must be blocked to prevent SSRF attacks
const PRIVATE_RANGES: RegExp[] = [
  // IPv4 loopback
  /^127\./,
  // RFC 1918 private ranges
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  // AWS metadata / link-local
  /^169\.254\./,
  // "This" network
  /^0\./,
  // IPv6 loopback
  /^::1$/,
  // IPv6 unique local
  /^fc/i,
  /^fd/i,
];

/**
 * Returns true if the URL is safe to make a server-side request to.
 * Blocks localhost, loopback addresses, and private IP ranges.
 *
 * Use this before making any HTTP request to a user-supplied URL
 * (e.g., GitLab self-hosted baseUrl, Azure DevOps organizationUrl).
 */
export function isSsrfSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Strip brackets from IPv6 addresses (URL.hostname returns "[::1]" for IPv6)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

    // Block localhost by name
    if (hostname === "localhost") return false;

    // Block if hostname is a private/loopback IP
    if (PRIVATE_RANGES.some((r) => r.test(hostname))) return false;

    // Only allow http/https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    return true;
  } catch {
    // Invalid URL
    return false;
  }
}
