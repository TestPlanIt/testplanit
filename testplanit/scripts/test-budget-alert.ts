/**
 * Test script to enqueue a budget alert check job without making real LLM calls.
 *
 * Usage:
 *   pnpm dotenv -- tsx scripts/test-budget-alert.ts <integrationId>
 *
 * Example:
 *   pnpm dotenv -- tsx scripts/test-budget-alert.ts 5
 *
 * Prerequisites:
 *   - Workers must be running: pnpm workers
 *   - Insert LlmUsage records first to simulate spend (see .planning docs)
 */

import { Queue } from "bullmq";
import { BUDGET_ALERT_QUEUE_NAME } from "../lib/queueNames";
import valkeyConnection from "../lib/valkey";

const BUDGET_ALERT_JOB_CHECK = "check-budget";

async function main() {
  const integrationId = parseInt(process.argv[2], 10);
  if (!integrationId || isNaN(integrationId)) {
    console.error("Usage: tsx scripts/test-budget-alert.ts <integrationId>");
    console.error("Example: tsx scripts/test-budget-alert.ts 5");
    process.exit(1);
  }

  if (!valkeyConnection) {
    console.error("Valkey connection not available. Check VALKEY_URL in .env");
    process.exit(1);
  }

  const queue = new Queue(BUDGET_ALERT_QUEUE_NAME, {
    connection: valkeyConnection as any,
  });

  const job = await queue.add(BUDGET_ALERT_JOB_CHECK, {
    llmIntegrationId: integrationId,
  });

  console.log(
    `Enqueued budget check job ${job.id} for integration ${integrationId}`
  );
  console.log("The budget alert worker will pick this up and check thresholds.");

  await queue.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to enqueue budget check:", err);
  process.exit(1);
});
