import { Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { TESTMO_IMPORT_QUEUE_NAME } from "../lib/queues";
import valkeyConnection from "../lib/valkey";

async function main() {
  if (!valkeyConnection) {
    console.error("Valkey connection is not available; cannot clear queue.");
    process.exit(1);
  }

  const queue = new Queue(TESTMO_IMPORT_QUEUE_NAME, {
    connection: valkeyConnection,
  });

  console.log(`Clearing queue "${TESTMO_IMPORT_QUEUE_NAME}"...`);
  await queue.drain(true);
  await queue.obliterate({ force: true });
  await queue.close();
  console.log("Queue cleared.");

  const prisma = new PrismaClient();
  try {
    console.log("Deleting Testmo import jobs...");
    await prisma.testmoImportDataset.deleteMany();
    await prisma.testmoImportJob.deleteMany();
    console.log("Testmo import job records deleted.");
  } finally {
    await prisma.$disconnect();
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
