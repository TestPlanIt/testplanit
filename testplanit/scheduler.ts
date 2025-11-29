import { forecastQueue, notificationQueue } from "./lib/queues";
import { FORECAST_QUEUE_NAME, NOTIFICATION_QUEUE_NAME } from "./lib/queues";
import { JOB_UPDATE_ALL_CASES } from "./workers/forecastWorker";
import { JOB_SEND_DAILY_DIGEST } from "./workers/notificationWorker";

// Define the cron schedule (e.g., every day at 3:00 AM server time)
// Uses standard cron syntax: min hour day(month) month day(week)
const CRON_SCHEDULE_DAILY_3AM = "0 3 * * *";
const CRON_SCHEDULE_DAILY_8AM = "0 8 * * *"; // For daily digest emails

async function scheduleJobs() {
  console.log("Attempting to schedule jobs...");

  if (!forecastQueue || !notificationQueue) {
    console.error("Required queues are not initialized. Cannot schedule jobs.");
    process.exit(1); // Exit if queues aren't available
  }

  try {
    // Clean up any old versions of the repeatable job first
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

    // Add the repeatable job to update all cases
    await forecastQueue.add(
      JOB_UPDATE_ALL_CASES, // Job name from worker
      {}, // No specific data needed
      {
        repeat: {
          // BullMQ v3+ uses pattern instead of cron
          // For older versions use: cron: CRON_SCHEDULE_DAILY_3AM
          pattern: CRON_SCHEDULE_DAILY_3AM,
          // tz: 'UTC', // Example: Explicitly set timezone if needed
        },
        jobId: JOB_UPDATE_ALL_CASES, // Use the job name as a predictable ID
      }
    );

    console.log(
      `Successfully scheduled repeatable job "${JOB_UPDATE_ALL_CASES}" with pattern "${CRON_SCHEDULE_DAILY_3AM}" on queue "${FORECAST_QUEUE_NAME}".`
    );

    // Schedule daily digest notifications
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

    // Add the repeatable job for daily digest
    await notificationQueue.add(
      JOB_SEND_DAILY_DIGEST,
      {},
      {
        repeat: {
          pattern: CRON_SCHEDULE_DAILY_8AM,
        },
        jobId: JOB_SEND_DAILY_DIGEST,
      }
    );

    console.log(
      `Successfully scheduled repeatable job "${JOB_SEND_DAILY_DIGEST}" with pattern "${CRON_SCHEDULE_DAILY_8AM}" on queue "${NOTIFICATION_QUEUE_NAME}".`
    );
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
