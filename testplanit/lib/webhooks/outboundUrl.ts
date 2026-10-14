import { decrypt, encrypt, isEncrypted } from "~/utils/encryption";

/**
 * An outbound webhook's URL is stored encrypted: for Slack and similar
 * services the URL itself is the credential that lets anyone post.
 */
export async function sealOutboundUrl(url: string): Promise<string> {
  return encrypt(url);
}

/** The stored URL, decrypted. Rows saved before encryption hold it in the clear. */
export async function openOutboundUrl(stored: string): Promise<string>;
export async function openOutboundUrl(
  stored: string | null | undefined
): Promise<string | null>;
export async function openOutboundUrl(
  stored: string | null | undefined
): Promise<string | null> {
  if (!stored) return null;
  return isEncrypted(stored) ? decrypt(stored) : stored;
}

/** What the settings page shows of a URL: its origin and last four characters. */
export function outboundUrlHint(url: string): string {
  const tail = url.slice(-4);
  try {
    return `${new URL(url).origin}/…${tail}`;
  } catch {
    return `…${tail}`;
  }
}
