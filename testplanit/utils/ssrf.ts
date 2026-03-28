import { lookup } from "node:dns/promises";

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
  // IPv6 link-local
  /^fe80:/i,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some((r) => r.test(ip));
}

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
    if (isPrivateIp(hostname)) return false;

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

/**
 * Resolve a URL's hostname via DNS and verify the resolved IP is not private.
 * This closes the DNS rebinding gap where a public hostname resolves to a
 * private/internal IP address.
 *
 * Call this immediately before fetch() to minimize the TOCTOU window.
 * Throws if the resolved address is private or the hostname cannot be resolved.
 */
export async function assertSsrfSafeResolved(url: string): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // Skip DNS lookup for raw IP addresses — already checked by isSsrfSafe()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) {
    return;
  }

  try {
    const { address } = await lookup(hostname);
    if (isPrivateIp(address)) {
      throw new Error(
        "Request blocked: hostname resolves to a private or internal address"
      );
    }
  } catch (err: any) {
    if (err.message?.includes("Request blocked")) throw err;
    throw new Error(`DNS resolution failed for ${hostname}: ${err.message}`);
  }
}
