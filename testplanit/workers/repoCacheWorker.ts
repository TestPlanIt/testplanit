import { Job, Worker } from "bullmq";
import { pathToFileURL } from "node:url";
import { repoFileCache } from "../lib/integrations/cache/RepoFileCache";
import {
  disconnectAllTenantClients, getPrismaClientForJob,
  isMultiTenantMode, validateMultiTenantJobData
} from "../lib/multiTenantPrisma";
import { REPO_CACHE_QUEUE_NAME } from "../lib/queueNames";
import { refreshRepoCache } from "../lib/services/repoCacheRefreshService";
import valkeyConnection from "../lib/valkey";

export const JOB_REFRESH_EXPIRED_CACHES = "refresh-expired-repo-caches";

const processor = async (job: Job) => {
  console.log(
    `Processing job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`
  );

  // Validate multi-tenant job data if in multi-tenant mode
  validateMultiTenantJobData(job.data);

  // In multi-tenant mode, RepoFileCache.getFiles() reads getCurrentTenantId()
  // (which returns process.env.INSTANCE_TENANT_ID) to scope Valkey cache keys.
  // Workers are shared across tenants, so we temporarily set the env var to
  // match the job's tenant before any cache operations.
  const previousTenantId = process.env.INSTANCE_TENANT_ID;
  if (job.data.tenantId) {
    process.env.INSTANCE_TENANT_ID = job.data.tenantId;
  }

  try {
  // Get the appropriate Prisma client (tenant-specific or default)
  const prisma = getPrismaClientForJob(job.data);

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  switch (job.name) {
    case JOB_REFRESH_EXPIRED_CACHES: {
      console.log(`Job ${job.id}: Checking for expired code repository caches.`);

      // Find all configs where caching is enabled
      const configs = await (prisma as any).projectCodeRepositoryConfig.findMany({
        where: { cacheEnabled: true },
        select: { id: true, projectId: true, cacheTtlDays: true },
      });

      console.log(
        `Job ${job.id}: Found ${configs.length} cache-enabled code repository configs.`
      );

      for (const config of configs) {
        try {
          // Check if the Valkey cache still exists (non-expired)
          const cached = await repoFileCache.getFiles(config.id);
          if (cached && cached.length > 0) {
            skippedCount++;
            continue; // Cache is still valid, skip
          }

          // Cache is missing or expired — refresh it
          console.log(
            `Job ${job.id}: Refreshing expired cache for config ${config.id} (project ${config.projectId})`
          );

          const result = await refreshRepoCache(config.id, prisma);

          if (result.success) {
            successCount++;
            console.log(
              `Job ${job.id}: Refreshed cache for config ${config.id} — ${result.fileCount} files, ${result.contentCached} contents cached`
            );
          } else {
            failCount++;
            console.warn(
              `Job ${job.id}: Failed to refresh cache for config ${config.id}: ${result.error}`
            );
          }
        } catch (error) {
          failCount++;
          console.error(
            `Job ${job.id}: Error refreshing cache for config ${config.id}:`,
            error
          );
          // Continue processing other configs
        }
      }

      console.log(
        `Job ${job.id} completed: ${successCount} refreshed, ${skippedCount} still valid, ${failCount} failed (of ${configs.length} total)`
      );
      break;
    }

    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }

  return { status: "completed", successCount, failCount, skippedCount };
  } finally {
    // Restore original INSTANCE_TENANT_ID
    if (previousTenantId !== undefined) {
      process.env.INSTANCE_TENANT_ID = previousTenantId;
    } else {
      delete process.env.INSTANCE_TENANT_ID;
    }
  }
};

async function startWorker() {
  if (isMultiTenantMode()) {
    console.log("Repo cache worker starting in MULTI-TENANT mode");
  } else {
    console.log("Repo cache worker starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    const worker = new Worker(REPO_CACHE_QUEUE_NAME, processor, {
      connection: valkeyConnection as any,
      concurrency: 1, // Serial processing — avoid hammering git APIs
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

    console.log("Repo cache worker started and listening for jobs...");

    const shutdown = async () => {
      console.log("Shutting down repo cache worker...");
      await worker.close();
      if (isMultiTenantMode()) {
        await disconnectAllTenantClients();
      }
      console.log("Repo cache worker shut down gracefully.");
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } else {
    console.warn(
      "Valkey connection not available. Repo cache worker cannot start."
    );
    process.exit(1);
  }
}

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
