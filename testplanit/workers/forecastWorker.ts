import { Worker, Job } from "bullmq";
import valkeyConnection from "../lib/valkey";
import { FORECAST_QUEUE_NAME } from "../lib/queueNames";
import {
  updateRepositoryCaseForecast,
  getUniqueCaseGroupIds,
  updateTestRunForecast,
} from "../services/forecastService";
import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma";

// Define expected job data structures (optional but good practice)
interface UpdateSingleCaseJobData {
  repositoryCaseId: number;
}

// Define job names for clarity and export them for the scheduler
export const JOB_UPDATE_SINGLE_CASE = "update-single-case-forecast";
export const JOB_UPDATE_ALL_CASES = "update-all-cases-forecast";

const processor = async (job: Job) => {
  console.log(`Processing job ${job.id} of type ${job.name}`);
  let successCount = 0;
  let failCount = 0;

  switch (job.name) {
    case JOB_UPDATE_SINGLE_CASE:
      const singleData = job.data as UpdateSingleCaseJobData;
      if (!singleData || typeof singleData.repositoryCaseId !== "number") {
        throw new Error(
          `Invalid data for job ${job.id}: repositoryCaseId missing or not a number.`
        );
      }
      try {
        await updateRepositoryCaseForecast(singleData.repositoryCaseId);
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
      const caseIds = await getUniqueCaseGroupIds();

      // Track affected TestRuns to update them once at the end
      const affectedTestRunIds = new Set<number>();

      // Process cases sequentially, skipping TestRun updates and collecting affected TestRuns
      for (const caseId of caseIds) {
        try {
          const result = await updateRepositoryCaseForecast(caseId, {
            skipTestRunUpdate: true,
            collectAffectedTestRuns: true,
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

      const activeTestRunIds = activeTestRuns.map((tr) => tr.id);
      const skippedCompletedCount =
        affectedTestRunIds.size - activeTestRunIds.length;

      console.log(
        `Job ${job.id}: Updating ${activeTestRunIds.length} active test runs (skipped ${skippedCompletedCount} completed)...`
      );
      let testRunSuccessCount = 0;
      let testRunFailCount = 0;

      for (const testRunId of activeTestRunIds) {
        try {
          await updateTestRunForecast(testRunId);
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

    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }

  return { status: "completed", successCount, failCount }; // Return summary
};

async function startWorker() {
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
