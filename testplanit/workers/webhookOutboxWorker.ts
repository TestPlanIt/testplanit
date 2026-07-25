import type { PrismaClient } from "@prisma/client";

import {
  disconnectAllTenantClients,
  getAllTenantIds,
  getTenantPrismaClient,
  isMultiTenantMode,
} from "../lib/multiTenantPrisma";
import { prisma } from "../lib/prisma";
import { getWebhookDispatchQueue } from "../lib/queues";
import { createTenantPollBackoff } from "../lib/tenantPollBackoff";
import { claimOutboxBatch, fanoutToConfigs } from "../lib/webhooks/outbox";

/**
 * outbound webhook outbox poller.
 *
 * Single-process polled loop (NOT a BullMQ Worker — claims its own work
 * directly from Postgres via FOR UPDATE SKIP LOCKED). Multiple replicas
 * can run concurrently without double-claiming.
 *
 * Multi-tenant mode: iterates getAllTenantIds() once per cadence and
 * polls each due tenant's database via getTenantPrismaClient(tenantId) —
 * idle tenants back off adaptively (see tenantBackoff below). The
 * per-tenant tenantId is stamped onto every enqueued dispatch job so the
 * dispatch worker routes to the correct tenant DB.
 *
 * Note on `attempt: 1` in the enqueued job: this is the INITIAL attempt
 * value. The dispatch worker overrides this on every processor
 * invocation with `job.attemptsMade + 1` so retry rows have the correct
 * 1-indexed attempt number.
 */

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 100;

/**
 * Multi-tenant only: an idle tenant's poll interval doubles per consecutive
 * empty poll up to this ceiling (~150x fewer polls than the base cadence), and
 * snaps back to POLL_INTERVAL_MS on the first poll that claims rows. Bounds
 * the idle Postgres fan-out across a mostly-hibernated fleet; the latency cost
 * is paid only on the first outbox event after a tenant's quiet period.
 * Single-tenant mode keeps the fixed cadence.
 */
const MAX_IDLE_POLL_INTERVAL_MS = 300_000;

const tenantBackoff = createTenantPollBackoff({
  baseIntervalMs: POLL_INTERVAL_MS,
  maxIntervalMs: MAX_IDLE_POLL_INTERVAL_MS,
});

/** Test hook: clears per-tenant backoff state between test cases. */
export function resetTenantBackoffForTests(): void {
  tenantBackoff.reset();
}

let stopRequested = false;
let inflight: Promise<number> | null = null;

export async function pollOnce(
  client: PrismaClient = prisma,
  tenantId?: string
): Promise<number> {
  const claimed = await claimOutboxBatch(client, BATCH_SIZE);
  if (claimed.length === 0) return 0;

  const queue = getWebhookDispatchQueue();
  if (!queue) {
    console.error(
      "[WebhookOutboxWorker] webhookDispatchQueue unavailable; rolling back claim is not possible (rows already marked dispatched). Will lose this batch."
    );
    return claimed.length;
  }

  const effectiveTenantId = tenantId ?? process.env.TENANT_ID ?? undefined;

  for (const row of claimed) {
    try {
      const configIds = await fanoutToConfigs(row, client);
      for (const webhookConfigId of configIds) {
        await queue.add(
          "dispatch",
          {
            outboxEventId: row.id,
            webhookConfigId,
            attempt: 1, // initial attempt; processor overrides on retries via job.attemptsMade + 1
            tenantId: effectiveTenantId,
          },
          {
            // Idempotent — re-enqueue same row produces no duplicate (BullMQ
            // skips existing jobIds). Separator is `--` rather than `:` because
            // BullMQ rejects custom IDs containing colons (`Custom Id cannot
            // contain :` thrown from Job.addJob; verified against
            // node_modules/bullmq/src/classes/job.ts).
            //
            // Tenant prefix: in multi-tenant mode each tenant has its own DB,
            // so two tenants can independently mint outbox rows whose ids
            // happen to collide (extremely unlikely with cuid/uuid but not
            // impossible). Prefixing with tenantId namespaces the BullMQ
            // idempotency key per tenant. Single-tenant mode (no tenantId)
            // falls back to the original `${id}--${cfg}` shape.
            jobId: effectiveTenantId
              ? `${effectiveTenantId}--${row.id}--${webhookConfigId}`
              : `${row.id}--${webhookConfigId}`,
          }
        );
      }
      console.log(
        `[WebhookOutboxWorker] Fan-out: outbox=${row.id} event=${row.eventName} configs=${configIds.length}${effectiveTenantId ? ` tenant=${effectiveTenantId}` : ""}`
      );
    } catch (err) {
      console.error(
        `[WebhookOutboxWorker] Fan-out error for outbox row ${row.id} (${row.eventName})${effectiveTenantId ? ` tenant=${effectiveTenantId}` : ""}:`,
        err
      );
      // Continue with next row — do NOT abort the whole batch
    }
  }
  return claimed.length;
}

/**
 * Run one polling pass across every configured tenant in multi-tenant mode,
 * or against the singleton client in single-tenant mode. Returns the total
 * number of rows claimed across all tenants this pass.
 */
export async function pollAllTenantsOnce(): Promise<number> {
  if (!isMultiTenantMode()) {
    return pollOnce();
  }

  const tenantIds = getAllTenantIds();
  if (tenantIds.length === 0) {
    return 0;
  }

  tenantBackoff.prune(tenantIds);

  let total = 0;
  for (const tenantId of tenantIds) {
    if (!tenantBackoff.shouldPoll(tenantId)) {
      continue;
    }
    try {
      const client = getTenantPrismaClient(tenantId);
      const claimed = await pollOnce(client, tenantId);
      total += claimed;
      if (claimed > 0) {
        tenantBackoff.recordWork(tenantId);
      } else {
        tenantBackoff.recordEmpty(tenantId);
      }
    } catch (err) {
      // An unreachable tenant backs off like an idle one so a down database
      // is not hammered every cycle; it self-heals on the next successful poll.
      tenantBackoff.recordEmpty(tenantId);
      console.error(
        `[WebhookOutboxWorker] Poll error for tenant ${tenantId}:`,
        err
      );
    }
  }
  return total;
}

export async function startLoop(): Promise<void> {
  if (isMultiTenantMode()) {
    console.log(
      `[WebhookOutboxWorker] Starting MULTI-TENANT poll loop (cadence=${POLL_INTERVAL_MS}ms, tenants=${getAllTenantIds().length})`
    );
  } else {
    console.log(
      `[WebhookOutboxWorker] Starting SINGLE-TENANT poll loop (cadence=${POLL_INTERVAL_MS}ms)`
    );
  }
  while (!stopRequested) {
    try {
      inflight = pollAllTenantsOnce();
      const n = await inflight;
      if (n === 0) {
        await sleep(POLL_INTERVAL_MS);
      }
      // If we got rows on this pass, do not sleep — drain backlog ASAP.
    } catch (err) {
      console.error("[WebhookOutboxWorker] Poll error:", err);
      await sleep(POLL_INTERVAL_MS);
    } finally {
      inflight = null;
    }
  }
  console.log("[WebhookOutboxWorker] Poll loop exited");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[WebhookOutboxWorker] Received ${signal}, shutting down...`);
  stopRequested = true;
  if (inflight) {
    try {
      await inflight;
    } catch {
      // Ignore errors from the in-flight poll — startLoop catches them
    }
  }
  if (isMultiTenantMode()) {
    await disconnectAllTenantClients();
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch(() => process.exit(1));
});

if (require.main === module) {
  console.log("[WebhookOutboxWorker] Running as standalone process...");
  startLoop().catch((err) => {
    console.error("[WebhookOutboxWorker] Loop failed:", err);
    process.exit(1);
  });
}
