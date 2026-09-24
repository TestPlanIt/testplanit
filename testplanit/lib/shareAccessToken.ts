import { createHmac, timingSafeEqual } from "crypto";

/**
 * Proof that a viewer entered a password-protected share's password.
 *
 * Issued by password-verify and sent back on later reads of the share. It is
 * `<expiresAtSeconds>.<signature>`, where the signature is an HMAC (keyed by
 * NEXTAUTH_SECRET) over the shareKey, the expiry, and the link's current
 * password hash. Knowing the link is not enough to forge one, a token only
 * opens the share it was issued for, and changing the password invalidates
 * every token issued before.
 */

export const SHARE_ACCESS_TOKEN_TTL_SECONDS = 3600;

function sign(shareKey: string, expiresAt: number, passwordHash: string) {
  return createHmac(
    "sha256",
    `share-access:${process.env.NEXTAUTH_SECRET ?? ""}`
  )
    .update(`${shareKey}\n${expiresAt}\n${passwordHash}`)
    .digest("base64url");
}

export function createShareAccessToken(
  shareKey: string,
  passwordHash: string,
  now: number = Date.now()
): string {
  const expiresAt = Math.floor(now / 1000) + SHARE_ACCESS_TOKEN_TTL_SECONDS;
  return `${expiresAt}.${sign(shareKey, expiresAt, passwordHash)}`;
}

export function verifyShareAccessToken(
  token: string | null | undefined,
  shareKey: string,
  passwordHash: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!token || !passwordHash) return false;
  const [expiresRaw, signature, ...rest] = token.split(".");
  if (!expiresRaw || !signature || rest.length > 0) return false;
  if (!/^\d+$/.test(expiresRaw)) return false;

  const expiresAt = Number(expiresRaw);
  if (expiresAt * 1000 <= now) return false;

  const expected = Buffer.from(sign(shareKey, expiresAt, passwordHash));
  const received = Buffer.from(signature);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
