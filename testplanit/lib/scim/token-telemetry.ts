/**
 * SCIM token sync-telemetry helper.
 *
 * `touchLastSync` is called from every SCIM service mutation
 * (create/put/patch/delete on Users + Groups) after the wrapping
 * `$transaction` commits. The write is fire-and-forget, race-safe, and
 * throttled to `SCIM_LAST_SYNC_THROTTLE_MS` (60s), mirroring the
 * `lastUsedAt` pattern in `lib/scim/auth.ts`.
 *
 *   - `lastSyncAt` answers "when did this token last successfully mutate
 *     something" — distinct from `lastUsedAt` which answers "when did
 *     this token last authenticate any request (read or write)."
 *   - The race-safe `WHERE` clause (`lastSyncAt < cutoff OR lastSyncAt IS
 *     NULL`) lets concurrent mutations from the same token coalesce to a
 *     single DB write per throttle window.
 *   - Errors are logged and swallowed; SCIM mutations never fail because
 *     the telemetry write failed.
 */

import { prisma } from "~/lib/prisma";
import { SCIM_LAST_SYNC_THROTTLE_MS } from "~/lib/scim/constants";

/**
 * Fire-and-forget update of `ScimToken.lastSyncAt` for the given token.
 *
 * Call AFTER the wrapping `$transaction` has committed so a transient DB
 * error on the telemetry write can never roll back the actual SCIM
 * mutation. Returns immediately — callers should NOT `await` this.
 */
export function touchLastSync(tokenId: string): void {
  const now = new Date();
  const cutoff = new Date(now.getTime() - SCIM_LAST_SYNC_THROTTLE_MS);
  void prisma.scimToken
    .updateMany({
      where: {
        id: tokenId,
        OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: cutoff } }],
      },
      data: { lastSyncAt: now },
    })
    .catch((err) => {
      console.error("[scim/token-telemetry] Failed to update lastSyncAt:", err);
    });
}
