import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "~/lib/prisma";

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
 * tenant-scoped PrismaClient (multi-tenant deployments) and tests can
 * inject a fully isolated mock.
 */
export async function retireExpiredSecrets(
  prisma: PrismaClient | Prisma.TransactionClient = defaultPrisma
): Promise<{ retiredCount: number }> {
  const now = new Date();
  const result = await prisma.webhookConfigSecret.updateMany({
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
