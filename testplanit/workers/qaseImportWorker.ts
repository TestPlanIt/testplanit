import { Job, Worker } from "bullmq";
import { runWithAuditContext } from "../lib/auditContext";
import type { ActorContextJobData } from "../lib/auditContextEnqueue";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  validateMultiTenantJobData,
  type MultiTenantJobData,
} from "../lib/multiTenantDb";
import { QASE_IMPORT_QUEUE_NAME } from "../lib/queueNames";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { captureAuditEvent } from "../lib/services/auditLog";
import { enqueueWithAuditContext } from "../lib/auditContextEnqueue";
import { getElasticsearchReindexQueue } from "../lib/queues";
import { runQaseFetch } from "../services/imports/qase/runQaseFetch";
import { runQaseImport } from "../services/imports/qase/runQaseImport";
import type { QaseImportMode } from "../services/imports/qase/types";

export type QaseImportJobData = ActorContextJobData<
  { jobId: string; mode: QaseImportMode } & MultiTenantJobData
>;

export async function processor(job: Job<QaseImportJobData>) {
  return runWithAuditContext(job.data.actorContext ?? {}, async () => {
    const { jobId, mode } = job.data;
    if (!jobId) {
      throw new Error("Job id is required");
    }
    validateMultiTenantJobData(job.data);
    const db = getDbClientForJob(job.data);

    if (mode === "fetch") {
      await runQaseFetch({ db, jobId });
      return;
    }
    if (mode === "import") {
      await runQaseImport({
        db,
        jobId,
        onCompleted: async (projectIds) => {
          const importJob = await db.qaseImportJob.findUnique({
            where: { id: jobId },
            select: { createdById: true, processedCount: true },
          });
          if (!importJob) {
            return;
          }
          await captureAuditEvent({
            action: "BULK_CREATE",
            entityType: "QaseImportJob",
            entityId: jobId,
            metadata: { projectIds, processedCount: importJob.processedCount },
          }).catch(() => {});
          const reindexQueue = getElasticsearchReindexQueue();
          if (!reindexQueue) {
            return;
          }
          for (const projectId of projectIds) {
            for (const entityType of [
              "repositoryCases",
              "sharedSteps",
            ] as const) {
              await enqueueWithAuditContext(
                reindexQueue,
                `reindex-after-qase-import-${jobId}-${projectId}-${entityType}`,
                {
                  entityType,
                  projectId,
                  userId: importJob.createdById,
                  tenantId: job.data.tenantId,
                }
              ).catch((error) => {
                console.error(
                  "Failed to queue reindex after Qase import",
                  error
                );
              });
            }
          }
        },
      });
      return;
    }
    throw new Error(`Unsupported Qase import mode: ${String(mode)}`);
  });
}

async function startWorker() {
  console.log(
    `Qase import worker starting in ${
      isMultiTenantMode() ? "MULTI-TENANT" : "SINGLE-TENANT"
    } mode`
  );

  if (!valkeyConnection) {
    console.warn(
      "Valkey connection not available. Qase import worker cannot start."
    );
    process.exit(1);
  }

  const worker = new Worker(
    QASE_IMPORT_QUEUE_NAME,
    withTenantContext(processor),
    {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: parseInt(process.env.QASE_IMPORT_CONCURRENCY || "1", 10),
    }
  );

  worker.on("completed", (job) => {
    console.log(`Qase import job ${job.id} completed (${job.name}).`);
  });

  worker.on("failed", (job, err) => {
    console.error(`Qase import job ${job?.id} failed with error:`, err);
  });

  worker.on("error", (err) => {
    console.error("Qase import worker encountered an error:", err);
  });

  console.log("Qase import worker started and listening for jobs...");

  const shutdown = async () => {
    console.log("Shutting down Qase import worker...");
    await worker.close();
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  startWorker().catch((err) => {
    console.error("Failed to start Qase import worker:", err);
    process.exit(1);
  });
}
