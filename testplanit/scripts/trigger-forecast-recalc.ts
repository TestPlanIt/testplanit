import { forecastQueue } from "../lib/queues";
import { JOB_UPDATE_ALL_CASES } from "../workers/forecastWorker";

async function triggerForecastRecalculation() {
  if (!forecastQueue) {
    console.error("Forecast queue not initialized. Make sure Valkey/Redis is running.");
    process.exit(1);
  }

  try {
    console.log("Queueing forecast recalculation job...");
    const job = await forecastQueue.add(JOB_UPDATE_ALL_CASES, {});
    console.log(`✓ Successfully queued forecast recalculation job: ${job.id}`);
    console.log(`  Job will be processed by the forecast worker`);
    console.log(`  Monitor progress with: pnpm pm2:logs`);
    process.exit(0);
  } catch (error) {
    console.error("✗ Failed to queue forecast recalculation:", error);
    process.exit(1);
  }
}

triggerForecastRecalculation();
