import { Job, Worker } from "bullmq";
import { runWithAuditContext } from "../lib/auditContext";
import type { ActorContextJobData } from "../lib/auditContextEnqueue";
import {
  disconnectAllTenantClients,
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { FORECAST_QUEUE_NAME } from "../lib/queueNames";
import { captureAuditEvent } from "../lib/services/auditLog";
import { NotificationService } from "../lib/services/notificationService";
import { getReviewReminderThresholdDays } from "../lib/services/reviewReminderConfig";
import { withTenantContext } from "../lib/tenantContext";
import { emitReviewReminderEvent } from "../lib/webhooks/event-emitters/reviewEvents";
import valkeyConnection from "../lib/valkey";
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

/**
 * Load the context required to compose a REVIEW_REMINDER notification for a
 * single PENDING review row. Mirrors the structure of `loadReviewContext`
 * in `app/actions/reviews.ts` but accepts a `prisma` argument so the
 * per-tenant client handed to the worker is used. Adds a `requesterName`
 * lookup that the action-side helper doesn't need.
 *
 * Returns null when the project or entity row is missing (deleted in flight
 * between the scan and the load) so the caller skips dispatch for that row
 * without throwing.
 */
async function loadReviewContextForReminder(
  prisma: any,
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
      prisma.projects.findUnique({
        where: { id: req.projectId },
        select: { id: true, name: true },
      }),
      prisma.workflows.findUnique({
        where: { id: req.fromStateId },
        select: { name: true },
      }),
      prisma.workflows.findUnique({
        where: { id: req.toStateId },
        select: { name: true, color: { select: { value: true } } },
      }),
      prisma.user.findUnique({
        where: { id: req.requestedByUserId },
        select: { name: true },
      }),
      req.assigneeUserId !== null
        ? prisma.user.findUnique({
            where: { id: req.assigneeUserId },
            select: { name: true },
          })
        : Promise.resolve(null),
      req.assigneeRoleId !== null
        ? prisma.roles.findUnique({
            where: { id: req.assigneeRoleId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
  if (!project) return null;

  let entityName: string | null = null;
  if (req.entityType === "CASE") {
    const row = await prisma.repositoryCases.findUnique({
      where: { id: req.entityId },
      select: { name: true },
    });
    entityName = row?.name ?? null;
  } else if (req.entityType === "RUN") {
    const row = await prisma.testRuns.findUnique({
      where: { id: req.entityId },
      select: { name: true },
    });
    entityName = row?.name ?? null;
  } else {
    const row = await prisma.sessions.findUnique({
      where: { id: req.entityId },
      select: { name: true },
    });
    entityName = row?.name ?? null;
  }
  if (entityName === null) return null;

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
    const prisma = getPrismaClientForJob(job.data);

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
            prismaClient: prisma,
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
        const caseIds = await getUniqueCaseGroupIds({ prismaClient: prisma });

        // Track affected TestRuns to update them once at the end
        const affectedTestRunIds = new Set<number>();

        // Process cases sequentially, skipping TestRun updates and collecting affected TestRuns
        for (const caseId of caseIds) {
          try {
            const result = await updateRepositoryCaseForecast(caseId, {
              skipTestRunUpdate: true,
              collectAffectedTestRuns: true,
              prismaClient: prisma,
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

        const activeTestRuns = await prisma.testRuns.findMany({
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
            await updateTestRunForecast(testRunId, { prismaClient: prisma });
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
          const milestonesToComplete = await prisma.milestones.findMany({
            where: {
              isCompleted: false,
              isDeleted: false,
              automaticCompletion: true,
              completedAt: {
                lte: now, // Due date has passed
              },
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
              await prisma.milestones.update({
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
          const milestonesToNotify = await prisma.milestones.findMany({
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
          const thresholdDays = await getReviewReminderThresholdDays(prisma);
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

          const pendingReviews = await prisma.reviewRequest.findMany({
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
                await prisma.reviewRequest.update({
                  where: { id: req.id },
                  data: { lastRemindedAt: now },
                });
                continue;
              }

              const context = await loadReviewContextForReminder(prisma, req);
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
              // elapses. Raw prisma here (not enhanced) so the
              // system-actor stamp bypasses the user-scope
              // @@deny('update', status != 'PENDING') policy on
              // ReviewRequest in race-condition windows.
              await prisma.$transaction(async (tx: any) => {
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
            `Job ${job.id} completed: ${successCount} reminded, ${failCount} failed.`
          );
        } catch (error) {
          console.error(`Job ${job.id}: review-reminder scan failed`, error);
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
