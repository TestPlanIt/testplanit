import { Worker, Job } from "bullmq";
import valkeyConnection from "../lib/valkey";
import { FORECAST_QUEUE_NAME } from "../lib/queueNames";
import {
  updateRepositoryCaseForecast,
  getUniqueCaseGroupIds,
  updateTestRunForecast,
} from "../services/forecastService";
import { pathToFileURL } from "node:url";
import {
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  disconnectAllTenantClients,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { NotificationService } from "../lib/services/notificationService";

// Define expected job data structures with multi-tenant support
interface UpdateSingleCaseJobData extends MultiTenantJobData {
  repositoryCaseId: number;
}

interface UpdateAllCasesJobData extends MultiTenantJobData {
  // No additional fields required for this job type
}

// Define job names for clarity and export them for the scheduler
export const JOB_UPDATE_SINGLE_CASE = "update-single-case-forecast";
export const JOB_UPDATE_ALL_CASES = "update-all-cases-forecast";
export const JOB_AUTO_COMPLETE_MILESTONES = "auto-complete-milestones";
export const JOB_MILESTONE_DUE_NOTIFICATIONS = "milestone-due-notifications";

const processor = async (job: Job) => {
  console.log(`Processing job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`);
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
        failCount = 1;
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

      const activeTestRunIds = activeTestRuns.map((tr: { id: number }) => tr.id);
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
      console.log(`Job ${job.id}: Starting auto-completion check for milestones.`);
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
        console.error(`Job ${job.id}: Error in auto-complete milestones job`, error);
        throw error;
      }
      break;

    case JOB_MILESTONE_DUE_NOTIFICATIONS:
      console.log(`Job ${job.id}: Starting milestone due notifications check.`);
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
          const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
          const isOverdue = daysDiff < 0;

          // Check if notification should be sent
          // Send if: overdue OR within notifyDaysBefore days of due date
          const shouldNotify = isOverdue || daysDiff <= milestone.notifyDaysBefore;

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
                isOverdue
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
        console.error(`Job ${job.id}: Error in milestone due notifications job`, error);
        throw error;
      }
      break;

    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }

  return { status: "completed", successCount, failCount }; // Return summary
};

async function startWorker() {
  // Log multi-tenant mode status
  if (isMultiTenantMode()) {
    console.log("Forecast worker starting in MULTI-TENANT mode");
  } else {
    console.log("Forecast worker starting in SINGLE-TENANT mode");
  }

  // Initialize the worker only if Valkey connection exists
  if (valkeyConnection) {
    const worker = new Worker(FORECAST_QUEUE_NAME, processor, {
      connection: valkeyConnection,
      concurrency: 5,
      limiter: {
        max: 100,
        duration: 1000,
      },
    });

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

// Conditionally call startWorker only when this file is executed directly
// This check ensures importing the file doesn't automatically start the worker
// Works with both ESM and CommonJS
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  typeof import.meta === "undefined" ||
  (import.meta as any).url === undefined
) {
  startWorker().catch((err) => {
    console.error("Failed to start worker:", err);
    process.exit(1);
  });
}
