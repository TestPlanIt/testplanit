import { Worker, Job } from "bullmq";
import valkeyConnection from "../lib/valkey";
import { SYNC_QUEUE_NAME } from "../lib/queueNames";
import { syncService, SyncJobData } from "../lib/integrations/services/SyncService";
import { pathToFileURL } from "node:url";

const processor = async (job: Job) => {
  console.log(`Processing sync job ${job.id} of type ${job.name}`);

  const jobData = job.data as SyncJobData;

  switch (job.name) {
    case "sync-issues":
      try {
        const result = await syncService.performSync(
          jobData.userId,
          jobData.integrationId,
          jobData.projectId,
          jobData.data,
          job // Pass job for progress reporting
        );

        if (result.errors.length > 0) {
          console.warn(
            `Sync completed with ${result.errors.length} errors:`,
            result.errors
          );
        }

        console.log(`Synced ${result.synced} issues successfully`);
        return result;
      } catch (error) {
        console.error("Failed to sync issues:", error);
        throw error;
      }

    case "sync-project-issues":
      try {
        if (!jobData.projectId) {
          throw new Error("Project ID is required for project sync");
        }

        const result = await syncService.performSync(
          jobData.userId,
          jobData.integrationId,
          jobData.projectId,
          jobData.data,
          job // Pass job for progress reporting
        );

        if (result.errors.length > 0) {
          console.warn(
            `Project sync completed with ${result.errors.length} errors:`,
            result.errors
          );
        }

        console.log(`Synced ${result.synced} issues from project successfully`);
        return result;
      } catch (error) {
        console.error("Failed to sync project issues:", error);
        throw error;
      }

    case "refresh-issue":
      try {
        if (!jobData.issueId) {
          throw new Error("Issue ID is required for issue refresh");
        }

        const result = await syncService.performIssueRefresh(
          jobData.userId,
          jobData.integrationId,
          jobData.issueId
        );

        if (!result.success) {
          throw new Error(result.error || "Failed to refresh issue");
        }

        console.log(`Refreshed issue ${jobData.issueId} successfully`);
        return result;
      } catch (error) {
        console.error(`Failed to refresh issue ${jobData.issueId}:`, error);
        throw error;
      }

    case "create-issue":
      try {
        if (!jobData.data) {
          throw new Error("Issue data is required for issue creation");
        }

        // TODO: Implement issue creation via adapter
        console.log("Issue creation not yet implemented in worker");
        return { success: false, error: "Not implemented" };
      } catch (error) {
        console.error("Failed to create issue:", error);
        throw error;
      }

    case "update-issue":
      try {
        if (!jobData.issueId || !jobData.data) {
          throw new Error("Issue ID and data are required for issue update");
        }

        // TODO: Implement issue update via adapter
        console.log("Issue update not yet implemented in worker");
        return { success: false, error: "Not implemented" };
      } catch (error) {
        console.error("Failed to update issue:", error);
        throw error;
      }

    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
};

let worker: Worker | null = null;

// Function to start the worker
const startWorker = async () => {
  if (valkeyConnection) {
    worker = new Worker(SYNC_QUEUE_NAME, processor, {
      connection: valkeyConnection,
      concurrency: 1, // Process 1 sync job at a time to manage memory usage
      lockDuration: 21600000, // 6 hours - allows for very large issue syncs
      maxStalledCount: 1, // Reduce automatic stalled job retries
      stalledInterval: 300000, // Check for stalled jobs every 5 minutes
    });

    worker.on("completed", (job) => {
      console.log(`Sync job ${job.id} completed successfully.`);
    });

    worker.on("failed", (job, err) => {
      console.error(`Sync job ${job?.id} failed:`, err);
    });

    worker.on("error", (err) => {
      console.error("Sync worker error:", err);
    });

    console.log(`Sync worker started for queue "${SYNC_QUEUE_NAME}".`);
  } else {
    console.warn("Valkey connection not available. Sync worker not started.");
  }

  // Allow graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down sync worker...");
    if (worker) {
      await worker.close();
    }
    process.exit(0);
  });
};

// Run the worker if this file is executed directly (works with both ESM and CommonJS)
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  (typeof import.meta === "undefined" ||
    (import.meta as any).url === undefined)
) {
  console.log("Sync worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start sync worker:", err);
    process.exit(1);
  });
}

export default worker;
