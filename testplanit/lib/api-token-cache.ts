/**
 * API Token Cache
 *
 * Short-TTL Valkey cache for successful token lookups. Extracted from
 * api-token-auth.ts so that the Prisma client extensions (in prisma.ts)
 * can invalidate cache entries on revoke/delete without creating a
 * circular import (prisma.ts → api-token-auth.ts → prisma.ts).
 *
 * Cache key:  apiToken:<tokenHash>
 * Cache TTL:  see API_TOKEN_CACHE_TTL_SECONDS
 */

import valkeyConnection from "./valkey";

export const API_TOKEN_CACHE_TTL_SECONDS = 30;
export const API_TOKEN_CACHE_PREFIX = "apiToken:";

export interface CachedTokenInfo {
  tokenId: string;
  userId: string;
  userAccess: string | null;
  scopes: string[];
  expiresAt: string | null;
}

export async function getCachedTokenInfo(
  tokenHash: string
): Promise<CachedTokenInfo | null> {
  if (!valkeyConnection) return null;
  try {
    const raw = await valkeyConnection.get(
      `${API_TOKEN_CACHE_PREFIX}${tokenHash}`
    );
    return raw ? (JSON.parse(raw) as CachedTokenInfo) : null;
  } catch {
    return null;
  }
}

export async function setCachedTokenInfo(
  tokenHash: string,
  info: CachedTokenInfo
): Promise<void> {
  if (!valkeyConnection) return;
  try {
    await valkeyConnection.set(
      `${API_TOKEN_CACHE_PREFIX}${tokenHash}`,
      JSON.stringify(info),
      "EX",
      API_TOKEN_CACHE_TTL_SECONDS
    );
  } catch {
    // Cache write failures are non-fatal
  }
}

/**
 * Invalidate a cached token after revocation/rotation. Safe to call at
 * any time. Called from the Prisma apiToken update/delete hooks so the
 * 30-second cache window never outlives a revocation.
 */
export async function invalidateApiTokenCache(tokenHash: string): Promise<void> {
  if (!valkeyConnection) return;
  try {
    await valkeyConnection.del(`${API_TOKEN_CACHE_PREFIX}${tokenHash}`);
  } catch {
    // non-fatal
  }
}
