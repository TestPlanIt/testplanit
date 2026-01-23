import { Queue } from "bullmq";
import {
  FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  EMAIL_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME,
  ELASTICSEARCH_REINDEX_QUEUE_NAME,
} from "../lib/queues";
import valkeyConnection from "../lib/valkey";

const QUEUE_NAMES = [
  FORECAST_QUEUE_NAME,
  NOTIFICATION_QUEUE_NAME,
  EMAIL_QUEUE_NAME,
  SYNC_QUEUE_NAME,
  TESTMO_IMPORT_QUEUE_NAME,
  ELASTICSEARCH_REINDEX_QUEUE_NAME,
];

async function clearQueue(queueName: string) {
  if (!valkeyConnection) {
    console.error("Valkey connection is not available; cannot clear queue.");
    return false;
  }

  try {
    const queue = new Queue(queueName, {
      connection: valkeyConnection as any,
    });

    console.log(`Clearing queue "${queueName}"...`);

    // Get counts before clearing
    const counts = await queue.getJobCounts();
    const totalJobs = Object.values(counts).reduce((sum, count) => sum + count, 0);

    if (totalJobs === 0) {
      console.log(`  Queue "${queueName}" is already empty.`);
    } else {
      console.log(`  Found ${totalJobs} jobs in "${queueName}"`);

      // Drain all waiting jobs
      await queue.drain(true);

      // Obliterate the entire queue (removes all data)
      await queue.obliterate({ force: true });

      console.log(`  ✓ Queue "${queueName}" cleared successfully.`);
    }

    await queue.close();
    return true;
  } catch (error: any) {
    console.error(`  ✗ Failed to clear queue "${queueName}":`, error.message);
    return false;
  }
}

async function main() {
  if (!valkeyConnection) {
    console.error("Valkey connection is not available; cannot clear queues.");
    process.exit(1);
  }

  console.log("Starting queue cleanup...\n");

  let successCount = 0;
  let failCount = 0;

  for (const queueName of QUEUE_NAMES) {
    const success = await clearQueue(queueName);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Queue cleanup complete!`);
  console.log(`  Successfully cleared: ${successCount} queues`);
  console.log(`  Failed to clear: ${failCount} queues`);
  console.log("=".repeat(50));

  if (valkeyConnection) {
    await valkeyConnection.quit();
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Failed to clear queues:", error);
  process.exit(1);
});
