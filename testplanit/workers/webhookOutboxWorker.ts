import { prisma } from "../lib/prisma";
import { getWebhookDispatchQueue } from "../lib/queues";
import { claimOutboxBatch, fanoutToConfigs } from "../lib/webhooks/outbox";

/**
 * v0.23.0 Phase 2 (D-02) — outbound webhook outbox poller.
 *
 * Single-process polled loop (NOT a BullMQ Worker — claims its own work
 * directly from Postgres via FOR UPDATE SKIP LOCKED). Multiple replicas
 * can run concurrently without double-claiming.
 *
 * Single-tenant only in Phase 2: the multi-tenant variant requires a
 * different sharding strategy (one poller per tenant DB) and is left for
 * Phase 4's polish work. Single-tenant deployments (the demo target) are
 * served by this poller verbatim.
 *
 * Note on `attempt: 1` in the enqueued job: this is the INITIAL attempt
 * value. The dispatch worker (Task 4.4) overrides this on every processor
 * invocation with `job.attemptsMade + 1` so retry rows have the correct
 * 1-indexed attempt number. We could omit `attempt` here entirely and let
 * the processor compute it from scratch, but keeping `attempt: 1` makes
 * the initial-attempt case explicit in the job data.
 */

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 100;

let stopRequested = false;
let inflight: Promise<number> | null = null;

export async function pollOnce(): Promise<number> {
  const claimed = await claimOutboxBatch(prisma, BATCH_SIZE);
  if (claimed.length === 0) return 0;

  const queue = getWebhookDispatchQueue();
  if (!queue) {
    console.error(
      "[WebhookOutboxWorker] webhookDispatchQueue unavailable; rolling back claim is not possible (rows already marked dispatched). Will lose this batch."
    );
    return claimed.length;
  }

  for (const row of claimed) {
    try {
      const configIds = await fanoutToConfigs(row, prisma);
      for (const webhookConfigId of configIds) {
        await queue.add(
          "dispatch",
          {
            outboxEventId: row.id,
            webhookConfigId,
            attempt: 1, // initial attempt; processor overrides on retries via job.attemptsMade + 1
            tenantId: process.env.TENANT_ID ?? undefined,
          },
          {
            // Idempotent — re-enqueue same row produces no duplicate (BullMQ skips existing jobIds).
            jobId: `${row.id}:${webhookConfigId}`,
          }
        );
      }
      console.log(
        `[WebhookOutboxWorker] Fan-out: outbox=${row.id} event=${row.eventName} configs=${configIds.length}`
      );
    } catch (err) {
      console.error(
        `[WebhookOutboxWorker] Fan-out error for outbox row ${row.id} (${row.eventName}):`,
        err
      );
      // Continue with next row — do NOT abort the whole batch
    }
  }
  return claimed.length;
}

export async function startLoop(): Promise<void> {
  console.log(
    "[WebhookOutboxWorker] Starting poll loop (cadence=" +
      POLL_INTERVAL_MS +
      "ms)"
  );
  while (!stopRequested) {
    try {
      inflight = pollOnce();
      const n = await inflight;
      if (n === 0) {
        await sleep(POLL_INTERVAL_MS);
      }
      // If batch was full (n === BATCH_SIZE), do not sleep — drain backlog ASAP.
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
