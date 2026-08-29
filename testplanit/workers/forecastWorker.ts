import { Job, Worker } from "bullmq";
import { runWithAuditContext } from "../lib/auditContext";
import type { ActorContextJobData } from "../lib/auditContextEnqueue";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { FORECAST_QUEUE_NAME } from "../lib/queueNames";
import {
  readSystemAbandonedRunIdleMinutes,
  resolveAbandonedRunTargetStateId,
  resolveEffectiveIdleMinutes,
} from "../lib/services/abandonedRuns";
import { captureAuditEvent } from "../lib/services/auditLog";
import { NotificationService } from "../lib/services/notificationService";
import { getReviewReminderThresholdDays } from "../lib/services/reviewReminderConfig";
import { withTenantContext } from "../lib/tenantContext";
import { emitReviewReminderEvent } from "../lib/webhooks/event-emitters/reviewEvents";
import { emitTestRunUpdateEvents } from "../lib/webhooks/event-emitters/testRunEvents";
import { syncTestRunToElasticsearch } from "../services/testRunSearch";
import { AUTOMATED_TEST_RUN_TYPES } from "../utils/testResultTypes";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import {
  getUniqueCaseGroupIds,
  updateRepositoryCaseForecast,
  updateTestRunForecast,
} from "../services/forecastService";

// Define expected job data structures with multi-tenant support
interface UpdateSingleCaseJobData extends MultiTenantJobData {
  repositoryCaseId: number;
}

interface _UpdateAllCasesJobData extends MultiTenantJobData {
  // No additional fields required for this job type
}

// every forecast job carries an actorContext injected by
// enqueueWithAuditContext so the worker can re-establish the ALS frame.
// Kept as an interface extension (rather than a strict generic) so the
// existing discriminated cast to UpdateSingleCaseJobData inside the switch
// continues to type-check. All job variants share the MultiTenantJobData
// base (tenantId) plus the actorContext field.
interface ForecastJobDataBase extends MultiTenantJobData {
  actorContext?: ActorContextJobData<unknown>["actorContext"];
}

// Define job names for clarity and export them for the scheduler
export const JOB_UPDATE_SINGLE_CASE = "update-single-case-forecast";
export const JOB_UPDATE_ALL_CASES = "update-all-cases-forecast";
export const JOB_AUTO_COMPLETE_MILESTONES = "auto-complete-milestones";
export const JOB_MILESTONE_DUE_NOTIFICATIONS = "milestone-due-notifications";
export const JOB_REVIEW_REMINDERS = "review-reminders";
export const JOB_SWEEP_ABANDONED_RUNS = "sweep-abandoned-runs";

/**
 * Load the name and liveness of a review's subject row.
 *
 * The worker's `db` is the raw client — no access policy, no soft-delete
 * filter — so a deleted case/run/session still reads back like any other
 * row. `isDeleted` has to be selected and checked explicitly. A null return
 * means the row is gone for good (hard-deleted).
 */
async function loadReviewSubject(
  db: any,
  entityType: "CASE" | "RUN" | "SESSION",
  entityId: number
): Promise<{ name: string; isDeleted: boolean } | null> {
  const model =
    entityType === "CASE"
      ? db.repositoryCases
      : entityType === "RUN"
        ? db.testRuns
        : db.sessions;
  const row = await model.findUnique({
    where: { id: entityId },
    select: { name: true, isDeleted: true },
  });
  return row ? { name: row.name, isDeleted: row.isDeleted === true } : null;
}

/**
 * Retire a PENDING review whose subject row no longer exists.
 *
 * Normally the delete itself cancels what it strands, in the deleting
 * transaction (`sideEffectsPlugin` -> `cancelReviewsForDeletedEntities`).
 * This is the backstop for delete paths that run on a plugin-free client
 * and therefore never fire that hook — without it the row stays PENDING
 * forever, invisible in the inbox (which hides deleted subjects) but still
 * eligible for a reminder every threshold window.
 *
 * Scoped to PENDING so a decision landing concurrently wins the race. No
 * reviewer notification: the subject is deleted, so there is nothing to
 * open, and a "your review was cancelled" ping about an invisible row is
 * the same noise this removes. The audit entry reuses the soft-delete
 * path's ENTITY_DELETED label plus a source marker, so the backstop stays
 * distinguishable from the in-line cancellation.
 */
async function cancelStaleReview(
  db: any,
  req: {
    id: string;
    projectId: number;
    entityType: string;
    entityId: number;
  },
  tenantId?: string
): Promise<boolean> {
  const result = await db.reviewRequest.updateMany({
    where: { id: req.id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if ((result?.count ?? 0) === 0) return false;

  await captureAuditEvent({
    action: "REVIEW_CANCELLED",
    entityType: "ReviewRequest",
    entityId: req.id,
    projectId: req.projectId,
    metadata: {
      cancelledBy: "ENTITY_DELETED",
      source: "review-reminder-worker",
      entityType: req.entityType,
      entityId: req.entityId,
    },
    tenantId,
  }).catch(() => {});

  return true;
}

/**
 * Load the context required to compose a REVIEW_REMINDER notification for a
 * single PENDING review row. Mirrors the structure of `loadReviewContext`
 * in `app/actions/reviews.ts` but accepts a `db` argument so the
 * per-tenant client handed to the worker is used. Adds a `requesterName`
 * lookup that the action-side helper doesn't need.
 *
 * Returns null when the project is missing, or when the entity row is gone
 * or soft-deleted (deleted in flight between the scan and the load), so the
 * caller skips dispatch for that row without throwing.
 */
async function loadReviewContextForReminder(
  db: any,
  req: {
    projectId: number;
    entityType: "CASE" | "RUN" | "SESSION";
    entityId: number;
    fromStateId: number;
    toStateId: number;
    requestedByUserId: string;
    assigneeUserId: string | null;
    assigneeRoleId: number | null;
  }
): Promise<{
  projectId: number;
  projectName: string;
  entityName: string;
  fromStateName: string;
  toStateName: string;
  toStateColor: string | null;
  requesterName: string;
  assigneeUserName: string | null;
  assigneeRoleName: string | null;
} | null> {
  const [project, fromState, toState, requester, assigneeUser, assigneeRole] =
    await Promise.all([
      db.projects.findUnique({
        where: { id: req.projectId },
        select: { id: true, name: true },
      }),
      db.workflows.findUnique({
        where: { id: req.fromStateId },
        select: { name: true },
      }),
      db.workflows.findUnique({
        where: { id: req.toStateId },
        select: { name: true, color: { select: { value: true } } },
      }),
      db.user.findUnique({
        where: { id: req.requestedByUserId },
        select: { name: true },
      }),
      req.assigneeUserId !== null
        ? db.user.findUnique({
            where: { id: req.assigneeUserId },
            select: { name: true },
          })
        : Promise.resolve(null),
      req.assigneeRoleId !== null
        ? db.roles.findUnique({
            where: { id: req.assigneeRoleId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
  if (!project) return null;

  const subject = await loadReviewSubject(db, req.entityType, req.entityId);
  // A soft-deleted subject counts as gone: the inbox hides those rows, so a
  // reminder about one nags the reviewer about work they cannot open.
  if (!subject || subject.isDeleted) return null;
  const entityName = subject.name;

  return {
    projectId: project.id,
    projectName: project.name,
    entityName,
    fromStateName: fromState?.name ?? "",
    toStateName: toState?.name ?? "",
    toStateColor: toState?.color?.value ?? null,
    requesterName: requester?.name ?? "",
    assigneeUserName: assigneeUser?.name ?? null,
    assigneeRoleName: assigneeRole?.name ?? null,
  };
}

// re-establish the ALS frame from job.data.actorContext so
// downstream captureAuditEvent calls in this processor pick up the
// originating user's context (or the systemReason for scheduled jobs, via
// W5 Option A — no per-worker systemReason handling needed).
export const processor = async (job: Job<ForecastJobDataBase>) =>
  runWithAuditContext(job.data.actorContext ?? {}, async () => {
    console.log(
      `Processing job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`
    );
    let successCount = 0;
    let failCount = 0;

    // Validate multi-tenant job data if in multi-tenant mode
    validateMultiTenantJobData(job.data);

    // Get the appropriate Prisma client (tenant-specific or default)
    const db = getDbClientForJob(job.data);

    switch (job.name) {
      case JOB_UPDATE_SINGLE_CASE:
        const singleData = job.data as UpdateSingleCaseJobData;
        if (!singleData || typeof singleData.repositoryCaseId !== "number") {
          throw new Error(
            `Invalid data for job ${job.id}: repositoryCaseId missing or not a number.`
          );
        }
        try {
          await updateRepositoryCaseForecast(singleData.repositoryCaseId, {
            dbClient: db,
          });
          successCount = 1;
          console.log(
            `Job ${job.id} completed: Updated forecast for case ${singleData.repositoryCaseId}`
          );
        } catch (error) {
          console.error(
            `Job ${job.id} failed for case ${singleData.repositoryCaseId}`,
            error
          );
          throw error; // Re-throw to mark job as failed
        }
        break;

      case JOB_UPDATE_ALL_CASES:
        console.log(`Job ${job.id}: Starting update for all active cases.`);
        // Reset counters for batch job
        successCount = 0;
        failCount = 0;
        // Use unique case group IDs to avoid recalculating the same linked groups multiple times
        const caseIds = await getUniqueCaseGroupIds({ dbClient: db });

        // Track affected TestRuns to update them once at the end
        const affectedTestRunIds = new Set<number>();

        // Process cases sequentially, skipping TestRun updates and collecting affected TestRuns
        for (const caseId of caseIds) {
          try {
            const result = await updateRepositoryCaseForecast(caseId, {
              skipTestRunUpdate: true,
              collectAffectedTestRuns: true,
              dbClient: db,
            });

            // Collect affected TestRun IDs
            for (const testRunId of result.affectedTestRunIds) {
              affectedTestRunIds.add(testRunId);
            }

            successCount++;
          } catch (error) {
            console.error(
              `Job ${job.id}: Failed to update forecast for case ${caseId}`,
              error
            );
            failCount++;
            // Continue processing other cases even if one fails
          }
        }

        console.log(
          `Job ${job.id}: Processed ${caseIds.length} unique case groups. Success: ${successCount}, Failed: ${failCount}`
        );

        // Filter out completed test runs (they're locked and don't need forecast updates)
        console.log(
          `Job ${job.id}: Filtering ${affectedTestRunIds.size} affected test runs...`
        );

        const activeTestRuns = await db.testRuns.findMany({
          where: {
            id: { in: Array.from(affectedTestRunIds) },
            isCompleted: false,
          },
          select: { id: true },
        });

        const activeTestRunIds = activeTestRuns.map(
          (tr: { id: number }) => tr.id
        );
        const skippedCompletedCount =
          affectedTestRunIds.size - activeTestRunIds.length;

        console.log(
          `Job ${job.id}: Updating ${activeTestRunIds.length} active test runs (skipped ${skippedCompletedCount} completed)...`
        );
        let testRunSuccessCount = 0;
        let testRunFailCount = 0;

        for (const testRunId of activeTestRunIds) {
          try {
            await updateTestRunForecast(testRunId, { dbClient: db });
            testRunSuccessCount++;
          } catch (error) {
            console.error(
              `Job ${job.id}: Failed to update forecast for test run ${testRunId}`,
              error
            );
            testRunFailCount++;
          }
        }

        console.log(
          `Job ${job.id} completed: Updated ${testRunSuccessCount} test runs. Failed: ${testRunFailCount}. Skipped ${skippedCompletedCount} completed.`
        );

        if (failCount > 0 || testRunFailCount > 0) {
          // Indicate partial failure but don't necessarily throw to allow job completion
          console.warn(
            `Job ${job.id} finished with ${failCount} case failures and ${testRunFailCount} test run failures.`
          );
          // throw new Error(`Completed with failures.`); // Uncomment to mark job as failed
        }
        break;

      case JOB_AUTO_COMPLETE_MILESTONES:
        console.log(
          `Job ${job.id}: Starting auto-completion check for milestones.`
        );
        try {
          // Find all milestones that should be auto-completed
          const now = new Date();
          const milestonesToComplete = await db.milestones.findMany({
            where: {
              isCompleted: false,
              isDeleted: false,
              automaticCompletion: true,
              completedAt: {
                lte: now, // Due date has passed
              },
              // LOCK-04 (Phase 17) + HOOK-02 (Phase 19, Pitfall 4): skip
              // ONLY actively-synced milestones — integrationId set AND
              // detachedAt null. MilestoneSyncService is the sole writer of
              // isCompleted for an actively-synced row; without this filter
              // the completion worker would race it and overwrite the
              // tracker's state. A CONVERTED (detached) milestone keeps
              // integrationId non-null for identity/badge purposes (Pitfall
              // 3) but is no longer tracker-owned — it must become eligible
              // for auto-completion again, so `integrationId != null` alone
              // is no longer a valid "skip" signal post-conversion.
              OR: [{ integrationId: null }, { detachedAt: { not: null } }],
            },
            select: {
              id: true,
              name: true,
              projectId: true,
            },
          });

          console.log(
            `Job ${job.id}: Found ${milestonesToComplete.length} milestones to auto-complete.`
          );

          for (const milestone of milestonesToComplete) {
            try {
              await db.milestones.update({
                where: { id: milestone.id },
                data: { isCompleted: true },
              });
              successCount++;
              // Audit logging — record milestone auto-completion
              captureAuditEvent({
                action: "UPDATE",
                entityType: "Milestones",
                entityId: String(milestone.id),
                entityName: milestone.name,
                projectId: milestone.projectId,
                tenantId: job.data.tenantId,
                metadata: {
                  source: "forecast-worker:auto-complete",
                  jobId: job.id,
                },
                changes: {
                  isCompleted: { old: false, new: true },
                },
              }).catch(() => {});
              console.log(
                `Job ${job.id}: Auto-completed milestone "${milestone.name}" (ID: ${milestone.id})`
              );
            } catch (error) {
              failCount++;
              console.error(
                `Job ${job.id}: Failed to auto-complete milestone ${milestone.id}`,
                error
              );
            }
          }

          console.log(
            `Job ${job.id} completed: Auto-completed ${successCount} milestones. Failed: ${failCount}`
          );
        } catch (error) {
          console.error(
            `Job ${job.id}: Error in auto-complete milestones job`,
            error
          );
          throw error;
        }
        break;

      case JOB_MILESTONE_DUE_NOTIFICATIONS:
        console.log(
          `Job ${job.id}: Starting milestone due notifications check.`
        );
        try {
          const now = new Date();

          // Find all milestones that need notifications
          // Include all users who have participated in the milestone:
          // - Milestone creator
          // - Test run creators and users with assigned/executed work
          // - Session creators and assigned users
          const milestonesToNotify = await db.milestones.findMany({
            where: {
              isCompleted: false,
              isDeleted: false,
              notifyDaysBefore: { gt: 0 },
              completedAt: { not: null }, // Has a due date
            },
            select: {
              id: true,
              name: true,
              completedAt: true,
              notifyDaysBefore: true,
              createdBy: true, // Milestone creator
              project: {
                select: {
                  id: true,
                  name: true,
                },
              },
              // Get all users who have participated in this milestone's test runs
              testRuns: {
                where: {
                  isDeleted: false,
                },
                select: {
                  createdById: true, // Test run creator
                  testCases: {
                    where: { isDeleted: false },
                    select: {
                      assignedToId: true, // Assigned user
                      results: {
                        select: {
                          executedById: true, // User who executed the result
                        },
                      },
                    },
                  },
                },
              },
              // Get all users who have participated in this milestone's sessions
              sessions: {
                where: {
                  isDeleted: false,
                },
                select: {
                  createdById: true, // Session creator
                  assignedToId: true, // Assigned user
                },
              },
            },
          });

          console.log(
            `Job ${job.id}: Found ${milestonesToNotify.length} milestones to check for notifications.`
          );

          for (const milestone of milestonesToNotify) {
            if (!milestone.completedAt) continue;

            const dueDate = new Date(milestone.completedAt);
            const timeDiff = dueDate.getTime() - now.getTime();
            // Use conditional rounding:
            // - Future dates (timeDiff >= 0): Math.ceil rounds up (conservative, only notify when truly within window)
            // - Overdue dates (timeDiff < 0): Math.floor rounds down (correctly catches any overdue amount)
            const daysDiff =
              timeDiff >= 0
                ? Math.ceil(timeDiff / (1000 * 60 * 60 * 24))
                : Math.floor(timeDiff / (1000 * 60 * 60 * 24));
            const isOverdue = daysDiff < 0;

            // Check if notification should be sent
            // Send if: overdue OR within notifyDaysBefore days of due date
            const shouldNotify =
              isOverdue || daysDiff <= milestone.notifyDaysBefore;

            console.log(
              `Job ${job.id}: Milestone "${milestone.name}" (ID: ${milestone.id}) - daysDiff: ${daysDiff}, notifyDaysBefore: ${milestone.notifyDaysBefore}, isOverdue: ${isOverdue}, shouldNotify: ${shouldNotify}`
            );

            if (!shouldNotify) continue;

            // Collect unique user IDs from all participants
            const userIds = new Set<string>();

            // Add milestone creator
            if (milestone.createdBy) {
              userIds.add(milestone.createdBy);
            }

            // Add test run creators, assigned users, and result executors
            for (const testRun of milestone.testRuns) {
              // Test run creator
              if (testRun.createdById) {
                userIds.add(testRun.createdById);
              }

              for (const testCase of testRun.testCases) {
                // Assigned user
                if (testCase.assignedToId) {
                  userIds.add(testCase.assignedToId);
                }

                // Users who executed results
                for (const result of testCase.results) {
                  if (result.executedById) {
                    userIds.add(result.executedById);
                  }
                }
              }
            }

            // Add session creators and assigned users
            for (const session of milestone.sessions) {
              // Session creator
              if (session.createdById) {
                userIds.add(session.createdById);
              }

              // Assigned user
              if (session.assignedToId) {
                userIds.add(session.assignedToId);
              }
            }

            if (userIds.size === 0) {
              console.log(
                `Job ${job.id}: Milestone "${milestone.name}" (ID: ${milestone.id}) - no participating users found, skipping notifications`
              );
              continue;
            }

            console.log(
              `Job ${job.id}: Milestone "${milestone.name}" (ID: ${milestone.id}) - sending notifications to ${userIds.size} users`
            );

            // Send notifications to each user
            for (const userId of userIds) {
              try {
                await NotificationService.createMilestoneDueNotification(
                  userId,
                  milestone.name,
                  milestone.project.name,
                  dueDate,
                  milestone.id,
                  milestone.project.id,
                  isOverdue,
                  job.data.tenantId
                );
                successCount++;
              } catch (error) {
                failCount++;
                console.error(
                  `Job ${job.id}: Failed to send notification for milestone ${milestone.id} to user ${userId}`,
                  error
                );
              }
            }
          }

          console.log(
            `Job ${job.id} completed: Sent ${successCount} milestone notifications. Failed: ${failCount}`
          );
        } catch (error) {
          console.error(
            `Job ${job.id}: Error in milestone due notifications job`,
            error
          );
          throw error;
        }
        break;

      case JOB_REVIEW_REMINDERS:
        console.log(`Job ${job.id}: Starting review-reminder scan.`);
        try {
          const thresholdDays = await getReviewReminderThresholdDays(db);
          if (thresholdDays === 0) {
            console.log(
              `Job ${job.id}: review_reminder_threshold_days is 0; reminders disabled.`
            );
            break;
          }
          const now = new Date();
          const cutoff = new Date(
            now.getTime() - thresholdDays * 24 * 60 * 60 * 1000
          );
          let staleCount = 0;

          const pendingReviews = await db.reviewRequest.findMany({
            where: {
              status: "PENDING",
              isDeleted: false,
              createdAt: { lt: cutoff },
              OR: [
                { lastRemindedAt: null },
                { lastRemindedAt: { lt: cutoff } },
              ],
            },
            select: {
              id: true,
              projectId: true,
              entityType: true,
              entityId: true,
              fromStateId: true,
              toStateId: true,
              requestedByUserId: true,
              assigneeUserId: true,
              assigneeRoleId: true,
              createdAt: true,
            },
          });

          console.log(
            `Job ${job.id}: Found ${pendingReviews.length} pending review requests overdue for reminder.`
          );

          for (const req of pendingReviews) {
            try {
              // Liveness gate first: a review whose subject has been deleted
              // can never be acted on. `app/[locale]/reviews/page.tsx` hides
              // those rows, so the assignee sees an empty inbox while the
              // reminder keeps arriving. Retire the row instead of nagging.
              const subject = await loadReviewSubject(
                db,
                req.entityType as "CASE" | "RUN" | "SESSION",
                req.entityId
              );
              if (!subject || subject.isDeleted) {
                if (await cancelStaleReview(db, req, job.data.tenantId)) {
                  staleCount++;
                }
                continue;
              }

              // Recipients: direct assignee XOR all role holders.
              // Requester exclusion is enforced upstream by
              // resolveRoleHolderUserIds for role assignments and by the
              // explicit self-assignment filter for direct assignments
              // (defense-in-depth — the schema @@validate also blocks
              // self-assignment at create time).
              const targetUserIds: string[] =
                req.assigneeUserId !== null
                  ? req.assigneeUserId === req.requestedByUserId
                    ? []
                    : [req.assigneeUserId]
                  : req.assigneeRoleId !== null
                    ? await NotificationService.resolveRoleHolderUserIds(
                        req.projectId,
                        req.assigneeRoleId,
                        req.requestedByUserId
                      )
                    : [];

              const hoursPending = Math.floor(
                (now.getTime() - new Date(req.createdAt).getTime()) /
                  (1000 * 60 * 60)
              );

              if (targetUserIds.length === 0) {
                // Stamp anyway so we don't re-scan this row every interval
                // (e.g., requester self-assignment edge case, or a role
                // that currently has no holders).
                await db.reviewRequest.update({
                  where: { id: req.id },
                  data: { lastRemindedAt: now },
                });
                continue;
              }

              const context = await loadReviewContextForReminder(db, req);
              if (!context) {
                // Entity or project deleted in flight; skip without
                // stamping so a future repair could re-target.
                continue;
              }

              await NotificationService.createReviewReminderNotification({
                targetUserIds,
                requesterUserId: req.requestedByUserId,
                requesterName: context.requesterName,
                projectId: context.projectId,
                projectName: context.projectName,
                entityType: req.entityType as "CASE" | "RUN" | "SESSION",
                entityId: req.entityId,
                entityName: context.entityName,
                fromStateName: context.fromStateName,
                toStateName: context.toStateName,
                reviewRequestId: req.id,
                hoursPending,
              });

              // Audit emission is best-effort — `.catch(() => {})` so a
              // transient audit pipeline failure cannot block the reminder
              // dispatch path. System actor (userId: null).
              await captureAuditEvent({
                action: "REVIEW_REMINDED" as any,
                entityType: "ReviewRequest",
                entityId: req.id,
                projectId: req.projectId,
                metadata: {
                  source: "review-reminder-worker",
                  jobId: job.id,
                  recipientCount: targetUserIds.length,
                  hoursPending,
                },
                tenantId: job.data.tenantId,
              }).catch(() => {});

              // Atomically emit the outbound webhook AND stamp
              // lastRemindedAt — if the outbox write fails, the stamp
              // doesn't land and the next scan retries; if both succeed,
              // the row won't be reminded again until the threshold
              // elapses. Raw db here (not enhanced) so the
              // system-actor stamp bypasses the user-scope
              // @@deny('update', status != 'PENDING') policy on
              // ReviewRequest in race-condition windows.
              await db.$transaction(async (tx: any) => {
                await emitReviewReminderEvent(
                  {
                    reviewRequestId: req.id,
                    projectId: context.projectId,
                    entityType: req.entityType as "CASE" | "RUN" | "SESSION",
                    entityId: req.entityId,
                    entityName: context.entityName,
                    fromStateId: req.fromStateId,
                    fromStateName: context.fromStateName,
                    toStateId: req.toStateId,
                    toStateName: context.toStateName,
                    toStateColor: context.toStateColor,
                    requestedByUserId: req.requestedByUserId,
                    requesterName: context.requesterName,
                    assigneeUserId: req.assigneeUserId,
                    assigneeUserName: context.assigneeUserName,
                    assigneeRoleId: req.assigneeRoleId,
                    assigneeRoleName: context.assigneeRoleName,
                    hoursPending,
                  },
                  { tx, actorUserId: null }
                );
                await tx.reviewRequest.update({
                  where: { id: req.id },
                  data: { lastRemindedAt: now },
                });
              });

              successCount++;
            } catch (err) {
              failCount++;
              console.error(
                `Job ${job.id}: review-reminder for ${req.id} failed`,
                err
              );
            }
          }

          console.log(
            `Job ${job.id} completed: ${successCount} reminded, ${staleCount} cancelled (subject deleted), ${failCount} failed.`
          );
        } catch (error) {
          console.error(`Job ${job.id}: review-reminder scan failed`, error);
          throw error;
        }
        break;

      case JOB_SWEEP_ABANDONED_RUNS:
        console.log(`Job ${job.id}: Starting abandoned automated-run sweep.`);
        try {
          const systemIdleMinutes = await readSystemAbandonedRunIdleMinutes(db);
          const sweepNow = new Date();

          // Incomplete automated runs plus each project's override knobs.
          // REGULAR (manual) runs are never swept — they legitimately stay
          // open for months.
          const candidates = await db.testRuns.findMany({
            where: {
              isCompleted: false,
              isDeleted: false,
              testRunType: { in: AUTOMATED_TEST_RUN_TYPES },
              project: { isDeleted: false },
            },
            select: {
              id: true,
              name: true,
              projectId: true,
              stateId: true,
              createdAt: true,
              project: {
                select: {
                  abandonedRunIdleMinutes: true,
                  abandonedRunStateId: true,
                },
              },
            },
          });

          // Per-project target-state cache — resolution costs up to two
          // workflow lookups, and a backlog is typically many runs across few
          // projects.
          const targetStateByProject = new Map<number, number | null>();

          for (const run of candidates) {
            const effectiveMinutes = resolveEffectiveIdleMinutes(
              systemIdleMinutes,
              run.project?.abandonedRunIdleMinutes ?? null
            );
            if (effectiveMinutes <= 0) continue; // sweeping disabled here

            // Last-activity signal: the newest imported suite/result write,
            // falling back to the run's creation when the reporter died
            // before importing anything (TestRuns has no updatedAt column).
            // "Incomplete" alone must never trigger the sweep — a live run
            // that is still streaming results looks identical except for
            // this timestamp.
            const [resultMax, suiteMax] = await Promise.all([
              db.jUnitTestResult.aggregate({
                _max: { createdAt: true },
                where: { testSuite: { testRunId: run.id } },
              }),
              db.jUnitTestSuite.aggregate({
                _max: { createdAt: true },
                where: { testRunId: run.id },
              }),
            ]);
            const lastActivityMs = Math.max(
              new Date(run.createdAt).getTime(),
              resultMax._max.createdAt
                ? new Date(resultMax._max.createdAt).getTime()
                : 0,
              suiteMax._max.createdAt
                ? new Date(suiteMax._max.createdAt).getTime()
                : 0
            );
            const idleMinutes =
              (sweepNow.getTime() - lastActivityMs) / (60 * 1000);
            if (idleMinutes < effectiveMinutes) continue;

            try {
              if (!targetStateByProject.has(run.projectId)) {
                targetStateByProject.set(
                  run.projectId,
                  await resolveAbandonedRunTargetStateId(
                    db,
                    run.projectId,
                    run.project?.abandonedRunStateId ?? null
                  )
                );
              }
              const targetStateId =
                targetStateByProject.get(run.projectId) ?? null;
              if (targetStateId === null) {
                console.warn(
                  `Job ${job.id}: No eligible RUNS workflow for project ${run.projectId}; completing run ${run.id} without a state change.`
                );
              }

              // The worker's client is the RAW ZenStack client (no
              // sideEffectsPlugin), so the side effects the app write path
              // gets for free are done by hand: completedAt stamp, webhook
              // emission (in-tx with the update so the outbox row commits
              // with it), audit capture, and the Elasticsearch sync. The
              // Review & Approval gate is deliberately bypassed — it is
              // enforced at the user-facing chokepoints, and a system sweep
              // has no human actor to route an approval to.
              const updatedRun = await db.$transaction(async (tx: any) => {
                // Re-check inside the tx: a very late completeTestRun could
                // land between the scan and this write — completing an
                // already-completed run again would clobber its state and
                // double-emit lifecycle webhooks.
                const current = await tx.testRuns.findUnique({
                  where: { id: run.id },
                  select: { isCompleted: true, stateId: true },
                });
                if (!current || current.isCompleted) return null;
                const oldRow = {
                  id: run.id,
                  projectId: run.projectId,
                  name: run.name,
                  stateId: current.stateId,
                  isCompleted: false,
                };
                const row = await tx.testRuns.update({
                  where: { id: run.id },
                  data: {
                    isCompleted: true,
                    completedAt: sweepNow,
                    ...(targetStateId !== null
                      ? { stateId: targetStateId }
                      : {}),
                  },
                  select: {
                    id: true,
                    projectId: true,
                    name: true,
                    stateId: true,
                    isCompleted: true,
                  },
                });
                await emitTestRunUpdateEvents(oldRow, row, tx, {
                  actorUserId: null,
                });
                return row;
              });
              if (!updatedRun) continue; // completed while we were scanning

              captureAuditEvent({
                action: "UPDATE",
                entityType: "TestRuns",
                entityId: String(run.id),
                entityName: run.name,
                projectId: run.projectId,
                tenantId: job.data.tenantId,
                metadata: {
                  source: "forecast-worker:abandoned-run-sweep",
                  jobId: job.id,
                  idleMinutes: Math.round(idleMinutes),
                  thresholdMinutes: effectiveMinutes,
                },
                changes: {
                  isCompleted: { old: false, new: true },
                  ...(updatedRun.stateId !== run.stateId
                    ? { stateId: { old: run.stateId, new: updatedRun.stateId } }
                    : {}),
                },
              }).catch(() => {});

              syncTestRunToElasticsearch(run.id).catch((error) =>
                console.error(
                  `Job ${job.id}: Failed to sync test run ${run.id} to Elasticsearch:`,
                  error
                )
              );

              successCount++;
              console.log(
                `Job ${job.id}: Closed abandoned run "${run.name}" (ID: ${run.id}, idle ${Math.round(idleMinutes)}m >= ${effectiveMinutes}m).`
              );
            } catch (error) {
              failCount++;
              console.error(
                `Job ${job.id}: Failed to close abandoned run ${run.id}`,
                error
              );
            }
          }

          console.log(
            `Job ${job.id} completed: Closed ${successCount} abandoned runs (${candidates.length} incomplete automated runs scanned). Failed: ${failCount}`
          );
        } catch (error) {
          console.error(`Job ${job.id}: Error in abandoned-run sweep`, error);
          throw error;
        }
        break;

      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }

    return { status: "completed", successCount, failCount }; // Return summary
  });

async function startWorker() {
  // Log multi-tenant mode status
  if (isMultiTenantMode()) {
    console.log("Forecast worker starting in MULTI-TENANT mode");
  } else {
    console.log("Forecast worker starting in SINGLE-TENANT mode");
  }

  // Initialize the worker only if Valkey connection exists
  if (valkeyConnection) {
    const worker = new Worker(
      FORECAST_QUEUE_NAME,
      withTenantContext(processor),
      {
        connection: valkeyConnection as any,
        prefix: BULLMQ_PREFIX,
        concurrency: parseInt(process.env.FORECAST_CONCURRENCY || "5", 10),
        limiter: {
          max: 100,
          duration: 1000,
        },
      }
    );

    worker.on("completed", (job, result) => {
      console.info(
        `Worker: Job ${job.id} (${job.name}) completed successfully. Result:`,
        result
      );
    });

    worker.on("failed", (job, err) => {
      console.error(
        `Worker: Job ${job?.id} (${job?.name}) failed with error:`,
        err
      );
    });

    worker.on("error", (err) => {
      console.error("Worker encountered an error:", err);
    });

    console.log("Forecast worker started and listening for jobs...");

    // Graceful shutdown handling
    const shutdown = async () => {
      console.log("Shutting down forecast worker...");
      await worker.close();
      // Disconnect all tenant Prisma clients in multi-tenant mode
      if (isMultiTenantMode()) {
        await disconnectAllTenantClients();
      }
      console.log("Forecast worker shut down gracefully.");
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } else {
    console.warn(
      "Valkey connection not available. Forecast worker cannot start."
    );
    process.exit(1);
  }
}

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  startWorker().catch((err) => {
    console.error("Failed to start worker:", err);
    process.exit(1);
  });
}
