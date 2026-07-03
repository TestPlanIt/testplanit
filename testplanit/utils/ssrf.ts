import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent } from "undici";
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
 * Call this immediately before fetch(). Returns the validated IP address the
 * caller should pin the connection to (via {@link createPinnedDispatcher}) so
 * fetch() cannot independently re-resolve the hostname to a different, private
 * address — closing the DNS-rebinding TOCTOU. Returns null when there is nothing
 * to pin: an allowlisted host, or a raw IP literal (no DNS lookup happens, so
 * there is no rebinding window).
 *
 * Throws if the resolved address is private or the hostname cannot be resolved.
 */
export async function assertSsrfSafeResolved(
  url: string,
  allowedHosts?: Set<string>
): Promise<string | null> {
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  // If this hostname is in the operator allowlist, skip all private-IP checks
  const allowed = allowedHosts ?? getAllowedPrivateHosts();
  if (allowed.has(hostname.toLowerCase())) {
    return null;
  }

  // For a raw IP literal (IPv4, IPv6, or IPv4-mapped IPv6) there is no DNS to
  // resolve — validate the literal numerically instead of skipping it. Skipping
  // any host containing ":" is what let IPv4-mapped IPv6 literals bypass this
  // re-check (GHSA-x7jm-4fpq-5mhm). No DNS lookup means no rebinding window, so
  // there is nothing to pin.
  if (isIP(hostname) !== 0) {
    if (isPrivateIp(hostname)) {
      throw new Error(
        "Request blocked: hostname resolves to a private or internal address"
      );
    }
    return null;
  }

  let address: string;
  try {
    ({ address } = await lookup(hostname));
  } catch (err: any) {
    throw new Error(`DNS resolution failed for ${hostname}: ${err.message}`);
  }

  if (isPrivateIp(address)) {
    throw new Error(
      "Request blocked: hostname resolves to a private or internal address"
    );
  }

  return address;
}

/**
 * Build an undici dispatcher that pins every connection to a single
 * pre-validated IP address, regardless of what DNS would otherwise return. Pass
 * it to fetch() as the `dispatcher` option so the socket connects to exactly the
 * address {@link assertSsrfSafeResolved} validated — the TCP connection can no
 * longer race a DNS rebind to an internal host. The URL's hostname is still used
 * for the Host header and TLS SNI, so certificate validation is unaffected.
 *
 * Create one per request and close it (fire-and-forget is fine — undici keeps an
 * in-flight response alive until its body is consumed).
 */
export function createPinnedDispatcher(ip: string): Agent {
  const family = isIP(ip) === 6 ? 6 : 4;
  // undici invokes lookup with the node dns.lookup signature. Handle both the
  // legacy (err, address, family) callback and the { all: true } array shape.
  const lookupFn = (
    _hostname: string,
    options: Record<string, unknown>,
    cb: (...args: unknown[]) => void
  ) => {
    if (options && options.all) {
      cb(null, [{ address: ip, family }]);
    } else {
      cb(null, ip, family);
    }
  };
  return new Agent({
    connect: { lookup: lookupFn } as Record<string, unknown>,
  } as ConstructorParameters<typeof Agent>[0]);
}
