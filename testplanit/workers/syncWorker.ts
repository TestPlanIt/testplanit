import { Job, Worker } from "bullmq";
import { runWithAuditContext } from "../lib/auditContext";
import type { ActorContextJobData } from "../lib/auditContextEnqueue";
import {
  SyncJobData,
  syncService,
} from "../lib/integrations/services/SyncService";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { SYNC_QUEUE_NAME } from "../lib/queueNames";
import { captureAuditEvent } from "../lib/services/auditLog";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";

// Extend SyncJobData with multi-tenant + actor-context support
interface MultiTenantSyncJobData
  extends ActorContextJobData<SyncJobData>, MultiTenantJobData {}

// re-establish the ALS frame from job.data.actorContext so
// downstream captureAuditEvent calls in this processor pick up the
// originating user's context (or the systemReason for scheduled jobs, via
// W5 Option A — no per-worker systemReason handling needed).
const processor = async (job: Job<MultiTenantSyncJobData>) =>
  runWithAuditContext(job.data.actorContext ?? {}, async () => {
    console.log(
      `Processing sync job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`
    );

    // Validate multi-tenant job data if in multi-tenant mode
    validateMultiTenantJobData(job.data);

    // Get the appropriate Prisma client (tenant-specific or default)
    const db = getDbClientForJob(job.data);
    const serviceOptions = { dbClient: db };

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

          // Audit logging — record sync operation
          captureAuditEvent({
            action: "BULK_UPDATE",
            entityType: "Issue",
            entityId: `sync-${jobData.integrationId}-${Date.now()}`,
            entityName: `Issue Sync`,
            userId: jobData.userId,
            projectId: jobData.projectId
              ? Number(jobData.projectId)
              : undefined,
            tenantId: jobData.tenantId,
            metadata: {
              source: "sync-worker",
              integrationId: jobData.integrationId,
              syncedCount: result.synced,
              errorCount: result.errors.length,
              jobId: job.id,
            },
          }).catch(() => {});

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

          // Audit logging — record project sync operation
          captureAuditEvent({
            action: "BULK_UPDATE",
            entityType: "Issue",
            entityId: `sync-${jobData.integrationId}-${Date.now()}`,
            entityName: `Issue Sync`,
            userId: jobData.userId,
            projectId: jobData.projectId
              ? Number(jobData.projectId)
              : undefined,
            tenantId: jobData.tenantId,
            metadata: {
              source: "sync-worker:project",
              integrationId: jobData.integrationId,
              syncedCount: result.synced,
              errorCount: result.errors.length,
              jobId: job.id,
            },
          }).catch(() => {});

          if (result.errors.length > 0) {
            console.warn(
              `Project sync completed with ${result.errors.length} errors:`,
              result.errors
            );
          }

          console.log(
            `Synced ${result.synced} issues from project successfully`
          );
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

          // Audit logging — record single issue refresh
          captureAuditEvent({
            action: "UPDATE",
            entityType: "Issue",
            entityId: String(jobData.issueId),
            userId: jobData.userId,
            tenantId: jobData.tenantId,
            metadata: {
              source: "sync-worker:refresh",
              integrationId: jobData.integrationId,
              jobId: job.id,
            },
          }).catch(() => {});

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

          // Issue creation via adapter is not yet implemented
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

          // Issue update via adapter is not yet implemented
          return { success: false, error: "Not implemented" };
        } catch (error) {
          console.error("Failed to update issue:", error);
          throw error;
        }

      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  });

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
    worker = new Worker(SYNC_QUEUE_NAME, withTenantContext(processor), {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: parseInt(process.env.SYNC_CONCURRENCY || "2", 10),
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

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("Sync worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start sync worker:", err);
    process.exit(1);
  });
}

export default worker;
