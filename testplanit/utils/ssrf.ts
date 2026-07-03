import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getAllowedPrivateHosts, isPrivateIp } from "~/lib/utils/ssrf";

/**
 * Returns true if the URL is safe to make a server-side request to.
 * Blocks localhost, loopback addresses, and private IP ranges.
 *
 * Use this before making any HTTP request to a user-supplied URL
 * (e.g., GitLab self-hosted baseUrl, Azure DevOps organizationUrl).
 */
export function isSsrfSafe(url: string, allowedHosts?: Set<string>): boolean {
  try {
    const parsed = new URL(url);
    // Strip brackets from IPv6 addresses (URL.hostname returns "[::1]" for IPv6)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

    // Only allow http/https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    // If this hostname is in the operator allowlist, skip private-IP checks
    const allowed = allowedHosts ?? getAllowedPrivateHosts();
    if (allowed.has(hostname.toLowerCase())) return true;

    // Block localhost by name
    if (hostname === "localhost") return false;

    // Block if hostname is a private/loopback IP
    if (isPrivateIp(hostname)) return false;

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
export async function assertSsrfSafeResolved(
  url: string,
  allowedHosts?: Set<string>
): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // If this hostname is in the operator allowlist, skip all private-IP checks
  const allowed = allowedHosts ?? getAllowedPrivateHosts();
  if (allowed.has(hostname.toLowerCase())) {
    return;
  }

  // For a raw IP literal (IPv4, IPv6, or IPv4-mapped IPv6) there is no DNS to
  // resolve — validate the literal numerically instead of skipping it. Skipping
  // any host containing ":" is what let IPv4-mapped IPv6 literals bypass this
  // re-check (GHSA-x7jm-4fpq-5mhm).
  if (isIP(hostname) !== 0) {
    if (isPrivateIp(hostname)) {
      throw new Error(
        "Request blocked: hostname resolves to a private or internal address"
      );
    }
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
