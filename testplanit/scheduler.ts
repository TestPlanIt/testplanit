import { getForecastQueue, getNotificationQueue } from "./lib/queues";
import { FORECAST_QUEUE_NAME, NOTIFICATION_QUEUE_NAME } from "./lib/queues";
import { JOB_UPDATE_ALL_CASES } from "./workers/forecastWorker";
import { JOB_SEND_DAILY_DIGEST } from "./workers/notificationWorker";
import { isMultiTenantMode, getAllTenantIds } from "./lib/multiTenantPrisma";

// Define the cron schedule (e.g., every day at 3:00 AM server time)
// Uses standard cron syntax: min hour day(month) month day(week)
const CRON_SCHEDULE_DAILY_3AM = "0 3 * * *";
const CRON_SCHEDULE_DAILY_8AM = "0 8 * * *"; // For daily digest emails

async function scheduleJobs() {
  console.log("Attempting to schedule jobs...");

  const forecastQueue = getForecastQueue();
  const notificationQueue = getNotificationQueue();

  if (!forecastQueue || !notificationQueue) {
    console.error("Required queues are not initialized. Cannot schedule jobs.");
    process.exit(1); // Exit if queues aren't available
  }

  try {
    const multiTenant = isMultiTenantMode();
    const tenantIds = multiTenant ? getAllTenantIds() : [undefined];

    if (multiTenant) {
      console.log(`Multi-tenant mode enabled. Scheduling jobs for ${tenantIds.length} tenants.`);
    }

    // Clean up any old versions of the repeatable forecast jobs first
    const repeatableJobs = await forecastQueue.getRepeatableJobs();
    let removedCount = 0;
    for (const job of repeatableJobs) {
      // Check job name specifically - avoids removing unrelated repeatable jobs
      if (job.name === JOB_UPDATE_ALL_CASES) {
        console.log(
          `Removing existing repeatable job "${job.name}" with key: ${job.key}`
        );
        await forecastQueue.removeRepeatableByKey(job.key);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      console.log(`Removed ${removedCount} old repeatable forecast jobs.`);
    }

    // Schedule forecast jobs for each tenant (or single job if not multi-tenant)
    for (const tenantId of tenantIds) {
      const jobId = tenantId
        ? `${JOB_UPDATE_ALL_CASES}-${tenantId}`
        : JOB_UPDATE_ALL_CASES;

      await forecastQueue.add(
        JOB_UPDATE_ALL_CASES,
        { tenantId }, // Include tenantId for multi-tenant support
        {
          repeat: {
            pattern: CRON_SCHEDULE_DAILY_3AM,
          },
          jobId,
        }
      );

      console.log(
        `Successfully scheduled repeatable job "${JOB_UPDATE_ALL_CASES}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_3AM}" on queue "${FORECAST_QUEUE_NAME}".`
      );
    }

    // Clean up any old versions of the repeatable notification jobs
    const notificationRepeatableJobs =
      await notificationQueue.getRepeatableJobs();
    let removedNotificationCount = 0;
    for (const job of notificationRepeatableJobs) {
      if (job.name === JOB_SEND_DAILY_DIGEST) {
        console.log(
          `Removing existing repeatable job "${job.name}" with key: ${job.key}`
        );
        await notificationQueue.removeRepeatableByKey(job.key);
        removedNotificationCount++;
      }
    }
    if (removedNotificationCount > 0) {
      console.log(
        `Removed ${removedNotificationCount} old repeatable notification jobs.`
      );
    }

    // Schedule notification digest jobs for each tenant (or single job if not multi-tenant)
    for (const tenantId of tenantIds) {
      const jobId = tenantId
        ? `${JOB_SEND_DAILY_DIGEST}-${tenantId}`
        : JOB_SEND_DAILY_DIGEST;

      await notificationQueue.add(
        JOB_SEND_DAILY_DIGEST,
        { tenantId }, // Include tenantId for multi-tenant support
        {
          repeat: {
            pattern: CRON_SCHEDULE_DAILY_8AM,
          },
          jobId,
        }
      );

      console.log(
        `Successfully scheduled repeatable job "${JOB_SEND_DAILY_DIGEST}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_8AM}" on queue "${NOTIFICATION_QUEUE_NAME}".`
      );
    }
  } catch (error) {
    console.error("Error scheduling jobs:", error);
    process.exit(1); // Exit if scheduling fails
  }
}

// Run the scheduling function
scheduleJobs()
  .then(() => {
    console.log("Scheduling script finished successfully.");
    // Close the connection used by the queue ONLY if this script is standalone
    // If part of app init, the main app should manage connection lifecycle
    // forecastQueue?.client.disconnect();
    process.exit(0); // Exit successfully
  })
  .catch((err) => {
    console.error("Scheduling script failed unexpectedly:", err);
    process.exit(1); // Exit with error
  });

// Keep the script running if it's part of a larger initialization process
// or exit if it's standalone.
// setTimeout(() => {}, 10000); // Example keep-alive
