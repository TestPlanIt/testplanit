import { getAllTenantIds, isMultiTenantMode } from "../lib/multiTenantPrisma";
import { getForecastQueue } from "../lib/queues";
import { JOB_MILESTONE_DUE_NOTIFICATIONS } from "../workers/forecastWorker";

async function triggerMilestoneNotifications() {
  const forecastQueue = getForecastQueue();
  if (!forecastQueue) {
    console.error("Forecast queue not initialized. Make sure Valkey/Redis is running.");
    process.exit(1);
  }

  try {
    const tenantIds = isMultiTenantMode() ? getAllTenantIds() : [undefined];
    console.log("Queueing milestone due notifications job...");
    for (const tenantId of tenantIds) {
      const job = await forecastQueue.add(JOB_MILESTONE_DUE_NOTIFICATIONS, { tenantId });
      console.log(`✓ Successfully queued milestone notifications job: ${job.id}${tenantId ? ` for tenant ${tenantId}` : ""}`);
    }
    console.log(`  Job will be processed by the forecast worker`);
    console.log(`  Monitor progress with: pnpm pm2:logs`);
    process.exit(0);
  } catch (error) {
    console.error("✗ Failed to queue milestone notifications:", error);
    process.exit(1);
  }
}

triggerMilestoneNotifications();
