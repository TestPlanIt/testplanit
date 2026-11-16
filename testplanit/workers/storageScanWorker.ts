import type { DbClient } from "../lib/zenstack";
import { Job, Worker } from "bullmq";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { STORAGE_SCAN_QUEUE_NAME } from "../lib/queueNames";
import {
  runStorageScan,
  type StorageScanResult,
} from "../lib/services/storageScan";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";

export interface StorageScanJobData extends MultiTenantJobData {
  /** The StorageScan row this job reports into. */
  scanId: number;
}

/**
 * Run one storage scan and record how it ended on its StorageScan row.
 * Exported for testing.
 */
export async function processStorageScan(
  job: Job<StorageScanJobData>,
  db: DbClient
): Promise<StorageScanResult> {
  validateMultiTenantJobData(job.data);
  const { scanId } = job.data;
  console.log(
    `Processing storage-scan job ${job.id} for scan ${scanId}` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );

  try {
    const result = await runStorageScan(db, scanId, async (objects) => {
      await job.updateProgress({ objects });
      await db.storageScan.update({
        where: { id: scanId },
        data: { objectCount: objects },
      });
    });
    await db.storageScan.update({
      where: { id: scanId },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        objectCount: result.objectCount,
        objectBytes: BigInt(result.objectBytes),
        orphanCount: result.orphanCount,
        orphanBytes: BigInt(result.orphanBytes),
        missingCount: result.missingCount,
      },
    });
    console.log(
      `Storage-scan job ${job.id} completed: objects=${result.objectCount} orphans=${result.orphanCount} missing=${result.missingCount}`
    );
    return result;
  } catch (error) {
    await db.storageScan
      .update({
        where: { id: scanId },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        },
      })
      .catch(() => {});
    throw error;
  }
}

let worker: Worker<StorageScanJobData, StorageScanResult> | null = null;

export function startStorageScanWorker() {
  if (isMultiTenantMode()) {
    console.log("Storage-scan worker starting in MULTI-TENANT mode");
  } else {
    console.log("Storage-scan worker starting in SINGLE-TENANT mode");
  }

  if (!valkeyConnection) {
    console.warn(
      "Valkey connection not available. Storage-scan worker not started."
    );
    return null;
  }

  worker = new Worker<StorageScanJobData, StorageScanResult>(
    STORAGE_SCAN_QUEUE_NAME,
    withTenantContext(async (job) =>
      processStorageScan(job, getDbClientForJob(job.data))
    ),
    {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`Storage-scan job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("Storage-scan worker error:", err);
  });

  console.log(
    `Storage-scan worker started for queue "${STORAGE_SCAN_QUEUE_NAME}".`
  );

  const shutdown = async () => {
    console.log("Shutting down storage-scan worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return worker;
}

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("Storage-scan worker running...");
  startStorageScanWorker();
}

export default worker;
