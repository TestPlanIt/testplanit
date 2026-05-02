import { getAllTenantIds, isMultiTenantMode } from "./lib/multiTenantPrisma";
import {
  FORECAST_QUEUE_NAME,
  getForecastQueue,
  getNotificationQueue,
  getRepoCacheQueue,
  getWebhookDispatchQueue,
  NOTIFICATION_QUEUE_NAME,
  REPO_CACHE_QUEUE_NAME,
  WEBHOOK_DISPATCH_QUEUE_NAME,
} from "./lib/queues";
import {
  JOB_AUTO_COMPLETE_MILESTONES,
  JOB_MILESTONE_DUE_NOTIFICATIONS,
  JOB_UPDATE_ALL_CASES,
} from "./workers/forecastWorker";
import { JOB_SEND_DAILY_DIGEST } from "./workers/notificationWorker";
import { JOB_REFRESH_EXPIRED_CACHES } from "./workers/repoCacheWorker";

// Define the cron schedule (e.g., every day at 3:00 AM server time)
// Uses standard cron syntax: min hour day(month) month day(week)
const CRON_SCHEDULE_DAILY_3AM = "0 3 * * *";
const CRON_SCHEDULE_DAILY_6AM = "0 6 * * *"; // For milestone auto-completion and notifications
const CRON_SCHEDULE_DAILY_8AM = "0 8 * * *"; // For daily digest emails
const CRON_SCHEDULE_DAILY_4AM = "0 4 * * *"; // For code repository cache refresh
const CRON_SCHEDULE_DAILY_2AM = "0 2 * * *"; // Plan 02-06 / D-04 — auto-retire expired WebhookConfigSecret rows
const JOB_RETIRE_EXPIRED_SECRETS = "retire-expired-secrets";

async function scheduleJobs() {
  console.log("Attempting to schedule jobs...");

  const forecastQueue = getForecastQueue();
  const notificationQueue = getNotificationQueue();
  const repoCacheQueue = getRepoCacheQueue();

  if (!forecastQueue || !notificationQueue || !repoCacheQueue) {
    console.error("Required queues are not initialized. Cannot schedule jobs.");
    process.exit(1);
  }

  try {
    const multiTenant = isMultiTenantMode();
    const tenantIds = multiTenant ? getAllTenantIds() : [undefined];

    if (multiTenant) {
      console.log(
        `Multi-tenant mode enabled. Scheduling jobs for ${tenantIds.length} tenants.`
      );
    }

    // Upsert forecast job schedulers for each tenant (or single job if not multi-tenant).
    // Using upsertJobScheduler avoids the race condition where concurrent scheduler
    // replicas remove-then-add, causing some tenants' jobs to be lost.
    for (const tenantId of tenantIds) {
      const updateAllCasesId = tenantId
        ? `${JOB_UPDATE_ALL_CASES}-${tenantId}`
        : JOB_UPDATE_ALL_CASES;

      await forecastQueue.upsertJobScheduler(
        updateAllCasesId,
        { pattern: CRON_SCHEDULE_DAILY_3AM },
        {
          name: JOB_UPDATE_ALL_CASES,
          data: { tenantId },
        }
      );

      console.log(
        `Upserted job scheduler "${JOB_UPDATE_ALL_CASES}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_3AM}" on queue "${FORECAST_QUEUE_NAME}".`
      );

      // Schedule milestone auto-completion job
      const autoCompleteId = tenantId
        ? `${JOB_AUTO_COMPLETE_MILESTONES}-${tenantId}`
        : JOB_AUTO_COMPLETE_MILESTONES;

      await forecastQueue.upsertJobScheduler(
        autoCompleteId,
        { pattern: CRON_SCHEDULE_DAILY_6AM },
        {
          name: JOB_AUTO_COMPLETE_MILESTONES,
          data: { tenantId },
        }
      );

      console.log(
        `Upserted job scheduler "${JOB_AUTO_COMPLETE_MILESTONES}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_6AM}" on queue "${FORECAST_QUEUE_NAME}".`
      );

      // Schedule milestone due notifications job
      const notificationsId = tenantId
        ? `${JOB_MILESTONE_DUE_NOTIFICATIONS}-${tenantId}`
        : JOB_MILESTONE_DUE_NOTIFICATIONS;

      await forecastQueue.upsertJobScheduler(
        notificationsId,
        { pattern: CRON_SCHEDULE_DAILY_6AM },
        {
          name: JOB_MILESTONE_DUE_NOTIFICATIONS,
          data: { tenantId },
        }
      );

      console.log(
        `Upserted job scheduler "${JOB_MILESTONE_DUE_NOTIFICATIONS}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_6AM}" on queue "${FORECAST_QUEUE_NAME}".`
      );
    }

    // Upsert notification digest job schedulers for each tenant
    for (const tenantId of tenantIds) {
      const digestId = tenantId
        ? `${JOB_SEND_DAILY_DIGEST}-${tenantId}`
        : JOB_SEND_DAILY_DIGEST;

      await notificationQueue.upsertJobScheduler(
        digestId,
        { pattern: CRON_SCHEDULE_DAILY_8AM },
        {
          name: JOB_SEND_DAILY_DIGEST,
          data: { tenantId },
        }
      );

      console.log(
        `Upserted job scheduler "${JOB_SEND_DAILY_DIGEST}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_8AM}" on queue "${NOTIFICATION_QUEUE_NAME}".`
      );
    }

    // Upsert repo cache refresh job schedulers for each tenant
    for (const tenantId of tenantIds) {
      const repoCacheId = tenantId
        ? `${JOB_REFRESH_EXPIRED_CACHES}-${tenantId}`
        : JOB_REFRESH_EXPIRED_CACHES;

      await repoCacheQueue.upsertJobScheduler(
        repoCacheId,
        { pattern: CRON_SCHEDULE_DAILY_4AM },
        {
          name: JOB_REFRESH_EXPIRED_CACHES,
          data: { tenantId },
        }
      );

      console.log(
        `Upserted job scheduler "${JOB_REFRESH_EXPIRED_CACHES}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_4AM}" on queue "${REPO_CACHE_QUEUE_NAME}".`
      );
    }

    // Plan 02-06 / Task 6.3 — daily auto-retire of expired WebhookConfigSecret
    // rows. Runs at 02:00 server time on each tenant; the dispatch worker has
    // a job-name short-circuit that calls retireExpiredSecrets directly.
    const webhookDispatchQueue = getWebhookDispatchQueue();
    if (webhookDispatchQueue) {
      for (const tenantId of tenantIds) {
        const jobId = tenantId
          ? `${JOB_RETIRE_EXPIRED_SECRETS}-${tenantId}`
          : JOB_RETIRE_EXPIRED_SECRETS;
        await webhookDispatchQueue.upsertJobScheduler(
          jobId,
          { pattern: CRON_SCHEDULE_DAILY_2AM },
          {
            name: JOB_RETIRE_EXPIRED_SECRETS,
            data: { tenantId },
          }
        );
        console.log(
          `Upserted job scheduler "${JOB_RETIRE_EXPIRED_SECRETS}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_DAILY_2AM}" on queue "${WEBHOOK_DISPATCH_QUEUE_NAME}".`
        );
      }
    } else {
      console.warn(
        `[scheduler] webhookDispatchQueue unavailable — auto-retire cron NOT registered`
      );
    }
  } catch (error) {
    console.error("Error scheduling jobs:", error);
    process.exit(1); // Exit if scheduling fails
  }
}

// Run the scheduling function only when executed directly (not on require).
// The CI smoke test require()s this module to validate its import graph;
// running scheduleJobs() then would try to connect to Valkey and fail.
if (require.main === module) {
  scheduleJobs()
    .then(async () => {
      console.log("Scheduling script finished successfully.");
      // Close all queue instances before exiting to flush pending Redis
      // operations and tear down event stream listeners cleanly.
      const forecastQueue = getForecastQueue();
      const notificationQueue = getNotificationQueue();
      const repoCacheQueue = getRepoCacheQueue();
      const webhookDispatchQueue = getWebhookDispatchQueue();
      await Promise.all([
        forecastQueue?.close(),
        notificationQueue?.close(),
        repoCacheQueue?.close(),
        webhookDispatchQueue?.close(),
      ]);
      console.log("All queues closed.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Scheduling script failed unexpectedly:", err);
      process.exit(1);
    });
}
