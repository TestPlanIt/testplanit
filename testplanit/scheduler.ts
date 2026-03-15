import { getAllTenantIds, isMultiTenantMode } from "./lib/multiTenantPrisma";
import { FORECAST_QUEUE_NAME, getForecastQueue, getNotificationQueue, getRepoCacheQueue, NOTIFICATION_QUEUE_NAME, REPO_CACHE_QUEUE_NAME } from "./lib/queues";
import {
  JOB_AUTO_COMPLETE_MILESTONES,
  JOB_MILESTONE_DUE_NOTIFICATIONS, JOB_UPDATE_ALL_CASES
} from "./workers/forecastWorker";
import { JOB_SEND_DAILY_DIGEST } from "./workers/notificationWorker";
import { JOB_REFRESH_EXPIRED_CACHES } from "./workers/repoCacheWorker";

// Define the cron schedule (e.g., every day at 3:00 AM server time)
// Uses standard cron syntax: min hour day(month) month day(week)
const CRON_SCHEDULE_DAILY_3AM = "0 3 * * *";
const CRON_SCHEDULE_DAILY_6AM = "0 6 * * *"; // For milestone auto-completion and notifications
const CRON_SCHEDULE_DAILY_8AM = "0 8 * * *"; // For daily digest emails
const CRON_SCHEDULE_DAILY_4AM = "0 4 * * *"; // For code repository cache refresh

async function scheduleJobs() {
  console.log("Attempting to schedule jobs...");

  const forecastQueue = getForecastQueue();
  const notificationQueue = getNotificationQueue();
  const repoCacheQueue = getRepoCacheQueue();

  if (!forecastQueue || !notificationQueue || !repoCacheQueue) {
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
      if (
        job.name === JOB_UPDATE_ALL_CASES ||
        job.name === JOB_AUTO_COMPLETE_MILESTONES ||
        job.name === JOB_MILESTONE_DUE_NOTIFICATIONS
      ) {
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

      // Schedule milestone auto-completion job
      const autoCompleteJobId = tenantId
        ? `${JOB_AUTO_COMPLETE_MILESTONES}-${tenantId}`
        : JOB_AUTO_COMPLETE_MILESTONES;

      await forecastQueue.add(
        JOB_AUTO_COMPLETE_MILESTONES,
        { tenantId },
        {
          repeat: {
            pattern: CRON_SCHEDULE_DAILY_6AM,
          },
          jobId: autoCompleteJobId,
        }
      );

      console.log(
        `Successfully scheduled repeatable job "${JOB_AUTO_COMPLETE_MILESTONES}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_6AM}" on queue "${FORECAST_QUEUE_NAME}".`
      );

      // Schedule milestone due notifications job
      const notificationsJobId = tenantId
        ? `${JOB_MILESTONE_DUE_NOTIFICATIONS}-${tenantId}`
        : JOB_MILESTONE_DUE_NOTIFICATIONS;

      await forecastQueue.add(
        JOB_MILESTONE_DUE_NOTIFICATIONS,
        { tenantId },
        {
          repeat: {
            pattern: CRON_SCHEDULE_DAILY_6AM,
          },
          jobId: notificationsJobId,
        }
      );

      console.log(
        `Successfully scheduled repeatable job "${JOB_MILESTONE_DUE_NOTIFICATIONS}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_6AM}" on queue "${FORECAST_QUEUE_NAME}".`
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

    // Clean up any old versions of the repeatable repo cache jobs
    const repoCacheRepeatableJobs = await repoCacheQueue.getRepeatableJobs();
    let removedRepoCacheCount = 0;
    for (const job of repoCacheRepeatableJobs) {
      if (job.name === JOB_REFRESH_EXPIRED_CACHES) {
        console.log(
          `Removing existing repeatable job "${job.name}" with key: ${job.key}`
        );
        await repoCacheQueue.removeRepeatableByKey(job.key);
        removedRepoCacheCount++;
      }
    }
    if (removedRepoCacheCount > 0) {
      console.log(
        `Removed ${removedRepoCacheCount} old repeatable repo cache jobs.`
      );
    }

    // Schedule repo cache refresh jobs for each tenant (or single job if not multi-tenant)
    for (const tenantId of tenantIds) {
      const jobId = tenantId
        ? `${JOB_REFRESH_EXPIRED_CACHES}-${tenantId}`
        : JOB_REFRESH_EXPIRED_CACHES;

      await repoCacheQueue.add(
        JOB_REFRESH_EXPIRED_CACHES,
        { tenantId },
        {
          repeat: {
            pattern: CRON_SCHEDULE_DAILY_4AM,
          },
          jobId,
        }
      );

      console.log(
        `Successfully scheduled repeatable job "${JOB_REFRESH_EXPIRED_CACHES}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_4AM}" on queue "${REPO_CACHE_QUEUE_NAME}".`
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
