import { getAllTenantIds, isMultiTenantMode } from "./lib/multiTenantDb";
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
  JOB_REVIEW_REMINDERS,
  JOB_SWEEP_ABANDONED_RUNS,
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
const CRON_SCHEDULE_HOURLY = "0 * * * *"; // Top of every hour — review-reminder scan
const CRON_SCHEDULE_EVERY_15_MIN = "*/15 * * * *"; // Abandoned automated-run sweep
const JOB_RETIRE_EXPIRED_SECRETS = "retire-expired-secrets";

/**
 * Remove job schedulers for tenants that are no longer in this worker group's
 * tenant config. Self-heals two cases:
 *  - a tenant migrated to another worker group (its schedulers under THIS
 *    group's BULLMQ_PREFIX must go away or its crons would run twice), and
 *  - a deprovisioned tenant (schedulers previously persisted forever).
 *
 * Safety properties:
 *  - getJobSchedulers() only sees schedulers under this process's BULLMQ_PREFIX,
 *    so one group can never delete another group's schedulers.
 *  - tenantId is parsed by stripping the KNOWN job-name prefix from the
 *    scheduler key (`${jobName}-${tenantId}`), never by splitting on "-" —
 *    tenant slugs may themselves contain hyphens.
 *  - Scheduler keys that exactly equal a job name (the single-tenant, no-suffix
 *    form) and keys that match no known job name are never touched.
 *  - Failures are logged and skipped; reconciliation must never block worker
 *    boot (the upserts above already succeeded — a stale scheduler is benign,
 *    a crash-looping pod is not).
 *
 * Exported for unit tests.
 */
export async function reconcileStaleSchedulers(
  queuesWithJobs: Array<{
    queue: {
      getJobSchedulers: (
        start?: number,
        end?: number,
        asc?: boolean
      ) => Promise<
        Array<{ key?: string | null; name?: string } | undefined | null>
      >;
      removeJobScheduler: (id: string) => Promise<unknown>;
      name: string;
    } | null;
    jobNames: string[];
  }>,
  activeTenants: Set<string>
): Promise<void> {
  for (const { queue, jobNames } of queuesWithJobs) {
    if (!queue) continue;

    let schedulers;
    try {
      schedulers = await queue.getJobSchedulers(0, -1, true);
    } catch (err) {
      console.warn(
        `[scheduler] Could not list job schedulers on queue "${queue.name}" for reconciliation:`,
        err
      );
      continue;
    }

    for (const scheduler of schedulers ?? []) {
      // Legacy (pre-BullMQ-5) repeat zset members have no scheduler hash, so
      // getJobSchedulers() yields undefined/keyless entries for them — seen
      // in prod 2026-06-05 (95 MD5-style members), where one such entry
      // TypeError'd the whole reconciliation pass. Skip them; they are
      // exactly the "foreign — never touch" case.
      const schedulerId = scheduler?.key;
      if (typeof schedulerId !== "string" || schedulerId.length === 0) continue;
      // Match the longest job name first so e.g. a hypothetical
      // "send-daily-digest-summary" job is not mistaken for
      // "send-daily-digest" with tenant "summary".
      const jobName = [...jobNames]
        .sort((a, b) => b.length - a.length)
        .find((n) => schedulerId === n || schedulerId.startsWith(`${n}-`));

      if (!jobName) continue; // foreign/unknown scheduler — never touch
      if (schedulerId === jobName) continue; // single-tenant form — never touch

      const tenantId = schedulerId.slice(jobName.length + 1);
      if (!tenantId) continue;
      if (activeTenants.has(tenantId)) continue;

      try {
        await queue.removeJobScheduler(schedulerId);
        console.log(
          `[scheduler] Reconciled away stale scheduler "${schedulerId}" on queue "${queue.name}" (tenant "${tenantId}" not in this worker group's config).`
        );
      } catch (err) {
        console.warn(
          `[scheduler] Failed to remove stale scheduler "${schedulerId}" on queue "${queue.name}" (will retry on next boot):`,
          err
        );
      }
    }
  }
}

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

      // Hourly scan for PENDING review requests older than the configurable
      // threshold (default 1 day via AppConfig.review_reminder_threshold_days;
      // 0 disables reminders) that have not been reminded within the same
      // window.
      const reminderId = tenantId
        ? `${JOB_REVIEW_REMINDERS}-${tenantId}`
        : JOB_REVIEW_REMINDERS;

      await forecastQueue.upsertJobScheduler(
        reminderId,
        { pattern: CRON_SCHEDULE_HOURLY },
        {
          name: JOB_REVIEW_REMINDERS,
          data: { tenantId },
        }
      );

      console.log(
        `Upserted job scheduler "${JOB_REVIEW_REMINDERS}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_HOURLY}" on queue "${FORECAST_QUEUE_NAME}".`
      );

      // Abandoned automated-run sweep — incomplete imported runs (JUnit et
      // al.) idle past the configurable threshold (system
      // AppConfig.abandoned_run_idle_minutes, per-project override on
      // Projects.abandonedRunIdleMinutes; 0/absent disables). Every 15
      // minutes to match the smallest threshold the UI accepts
      // (ABANDONED_RUN_MIN_IDLE_MINUTES), bounding worst-case close latency
      // at threshold + cadence.
      const abandonedRunsId = tenantId
        ? `${JOB_SWEEP_ABANDONED_RUNS}-${tenantId}`
        : JOB_SWEEP_ABANDONED_RUNS;

      await forecastQueue.upsertJobScheduler(
        abandonedRunsId,
        { pattern: CRON_SCHEDULE_EVERY_15_MIN },
        {
          name: JOB_SWEEP_ABANDONED_RUNS,
          data: { tenantId },
        }
      );

      console.log(
        `Upserted job scheduler "${JOB_SWEEP_ABANDONED_RUNS}"${tenantId ? ` for tenant ${tenantId}` : ""} with pattern "${CRON_SCHEDULE_EVERY_15_MIN}" on queue "${FORECAST_QUEUE_NAME}".`
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

    // Reconcile away schedulers for tenants no longer in this worker group's
    // config (migrated to another group, or deprovisioned). Multi-tenant only:
    // single-tenant deployments use suffix-less scheduler ids and have no
    // group concept. Own try/catch — reconciliation failures must not trip
    // the process.exit(1) below.
    if (multiTenant) {
      try {
        await reconcileStaleSchedulers(
          [
            {
              queue: forecastQueue,
              jobNames: [
                JOB_UPDATE_ALL_CASES,
                JOB_AUTO_COMPLETE_MILESTONES,
                JOB_MILESTONE_DUE_NOTIFICATIONS,
                JOB_REVIEW_REMINDERS,
                JOB_SWEEP_ABANDONED_RUNS,
              ],
            },
            { queue: notificationQueue, jobNames: [JOB_SEND_DAILY_DIGEST] },
            { queue: repoCacheQueue, jobNames: [JOB_REFRESH_EXPIRED_CACHES] },
            {
              queue: webhookDispatchQueue,
              jobNames: [JOB_RETIRE_EXPIRED_SECRETS],
            },
          ],
          new Set(tenantIds.filter((t): t is string => Boolean(t)))
        );
      } catch (err) {
        console.warn("[scheduler] Scheduler reconciliation failed:", err);
      }
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
