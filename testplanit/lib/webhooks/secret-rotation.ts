import type { DbClient, TxClient } from "~/lib/zenstack";

import { baseDb as defaultDb } from "~/lib/db";

/**
 * Daily auto-retire helper.
 *
 * Updates all `WebhookConfigSecret` rows where `retiredAt IS NULL` AND
 * `autoRetireAt < NOW()` to `retiredAt = NOW()`. Idempotent — running again
 * after the first sweep returns count=0 because the where-clause's
 * `retiredAt: null` filters out the rows we just stamped.
 *
 * Called from `scheduler.ts` via the `webhookDispatchWorker`'s daily
 * `retire-expired-secrets` cron job (single sweep per tenant per day).
 *
 * The helper accepts an optional client so the worker can pass its
 * tenant-scoped DbClient (multi-tenant deployments) and tests can
 * inject a fully isolated mock.
 */
export async function retireExpiredSecrets(
  baseDb: DbClient | TxClient = defaultDb
): Promise<{ retiredCount: number }> {
  const now = new Date();
  const result = await baseDb.webhookConfigSecret.updateMany({
    where: {
      retiredAt: null,
      autoRetireAt: { lt: now, not: null },
    },
    data: { retiredAt: now },
  });
  console.log(
    `[secret-rotation] Retired ${result.count} expired WebhookConfigSecret rows`
  );
  return { retiredCount: result.count };
}
