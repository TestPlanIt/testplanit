/**
 * Startup script to obliterate BullMQ queues that may have corrupted Redis keys.
 *
 * BullMQ stores queue metadata across several Redis keys (bull:<name>:id, :stalled, :events, etc.).
 * If any of those keys end up with the wrong data type (e.g. a string where a hash is expected),
 * the worker enters an infinite error loop on every poll cycle.
 *
 * Running Queue.obliterate() at startup deletes ALL bull:<name>:* keys for the listed queues,
 * giving them a clean slate. This is safe because:
 *  - The scheduler re-creates repeatable jobs on every startup (scheduler.ts runs before this).
 *  - Any in-flight jobs would already have been lost when the container restarted.
 *
 * Usage: tsx scripts/clean-queues.ts [queue-name ...]
 *   If no queue names are given, all known queues are obliterated.
 */

import { Queue } from "bullmq";
import {
  AUDIT_LOG_QUEUE_NAME,
  AUTO_TAG_QUEUE_NAME,
  BUDGET_ALERT_QUEUE_NAME,
  ELASTICSEARCH_REINDEX_QUEUE_NAME,
  EMAIL_QUEUE_NAME,
  FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  REPO_CACHE_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME,
} from "../lib/queueNames";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";

const ALL_QUEUES = [
  FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  EMAIL_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME,
  ELASTICSEARCH_REINDEX_QUEUE_NAME,
  AUDIT_LOG_QUEUE_NAME,
  BUDGET_ALERT_QUEUE_NAME,
  AUTO_TAG_QUEUE_NAME,
  REPO_CACHE_QUEUE_NAME,
];

async function main() {
  if (!valkeyConnection) {
    console.error("Valkey connection not available — skipping queue cleanup.");
    process.exit(0);
  }

  const requested = process.argv.slice(2);
  const queueNames = requested.length > 0 ? requested : ALL_QUEUES;

  for (const name of queueNames) {
    const queue = new Queue(name, {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
    });

    try {
      await queue.obliterate({ force: true });
      console.log(`Obliterated queue "${name}".`);
    } catch (err) {
      // obliterate can fail if keys are so corrupted that even SCAN breaks.
      // Fall back to raw DEL via the underlying Redis connection.
      console.warn(
        `obliterate() failed for "${name}", falling back to raw key deletion:`,
        (err as Error).message
      );
      try {
        const keys = await valkeyConnection.keys(`${BULLMQ_PREFIX}:${name}:*`);
        if (keys.length > 0) {
          await valkeyConnection.del(...keys);
          console.log(`Deleted ${keys.length} raw keys for queue "${name}".`);
        } else {
          console.log(`No keys found for queue "${name}".`);
        }
      } catch (rawErr) {
        console.error(
          `Failed to clean queue "${name}":`,
          (rawErr as Error).message
        );
      }
    } finally {
      await queue.close();
    }
  }

  // Disconnect so the process can exit
  await valkeyConnection.quit();
  console.log("Queue cleanup complete.");
}

main().catch((err) => {
  console.error("Queue cleanup script failed:", err);
  process.exit(1);
});
