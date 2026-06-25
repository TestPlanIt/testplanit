
import { Queue } from "bullmq";
import { createRawDbClient } from "~/lib/rawDbClient";
import { TESTMO_IMPORT_QUEUE_NAME } from "../lib/queues";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";

async function main() {
  if (!valkeyConnection) {
    console.error("Valkey connection is not available; cannot clear queue.");
    process.exit(1);
  }

  const queue = new Queue(TESTMO_IMPORT_QUEUE_NAME, {
    connection: valkeyConnection as any,
    prefix: BULLMQ_PREFIX,
  });

  console.log(`Clearing queue "${TESTMO_IMPORT_QUEUE_NAME}"...`);
  await queue.drain(true);
  await queue.obliterate({ force: true });
  await queue.close();
  console.log("Queue cleared.");

  const db = createRawDbClient();
  try {
    console.log("Deleting Testmo import jobs...");
    await db.testmoImportDataset.deleteMany();
    await db.testmoImportJob.deleteMany();
    console.log("Testmo import job records deleted.");
  } finally {
    await db.$disconnect();
    if (valkeyConnection) {
      await valkeyConnection.quit(); // or .disconnect()
    }

    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Failed to clear Testmo import queue:", error);
  process.exit(1);
});
