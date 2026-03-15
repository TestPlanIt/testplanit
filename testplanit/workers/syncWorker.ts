import { Job, Worker } from "bullmq";
import { pathToFileURL } from "node:url";
import {
  SyncJobData, syncService
} from "../lib/integrations/services/SyncService";
import {
  disconnectAllTenantClients, getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData, validateMultiTenantJobData
} from "../lib/multiTenantPrisma";
import { SYNC_QUEUE_NAME } from "../lib/queueNames";
import valkeyConnection from "../lib/valkey";

// Extend SyncJobData with multi-tenant support
interface MultiTenantSyncJobData extends SyncJobData, MultiTenantJobData {}

const processor = async (job: Job) => {
  console.log(
    `Processing sync job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`
  );

  // Validate multi-tenant job data if in multi-tenant mode
  validateMultiTenantJobData(job.data);

  // Get the appropriate Prisma client (tenant-specific or default)
  const prisma = getPrismaClientForJob(job.data);
  const serviceOptions = { prismaClient: prisma };

  const jobData = job.data as MultiTenantSyncJobData;

  switch (job.name) {
    case "sync-issues":
      try {
        const result = await syncService.performSync(
          jobData.userId,
          jobData.integrationId,
          jobData.projectId,
          jobData.data,
          job, // Pass job for progress reporting
          serviceOptions
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
          job, // Pass job for progress reporting
          serviceOptions
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
          jobData.issueId,
          serviceOptions
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
  // Log multi-tenant mode status
  if (isMultiTenantMode()) {
    console.log("Sync worker starting in MULTI-TENANT mode");
  } else {
    console.log("Sync worker starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    worker = new Worker(SYNC_QUEUE_NAME, processor, {
      connection: valkeyConnection as any,
      concurrency: parseInt(process.env.SYNC_CONCURRENCY || '2', 10),
      lockDuration: 21600000,
      maxStalledCount: 3,
      stalledInterval: 300000,
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
  const shutdown = async () => {
    console.log("Shutting down sync worker...");
    if (worker) {
      await worker.close();
    }
    // Disconnect all tenant Prisma clients in multi-tenant mode
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

// Run the worker if this file is executed directly (works with both ESM and CommonJS)
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  typeof import.meta === "undefined" ||
  (import.meta as any).url === undefined
) {
  console.log("Sync worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start sync worker:", err);
    process.exit(1);
  });
}

export default worker;
