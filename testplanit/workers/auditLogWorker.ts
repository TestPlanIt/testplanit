import { Worker, Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import valkeyConnection from "../lib/valkey";
import { AUDIT_LOG_QUEUE_NAME } from "../lib/queues";
import { pathToFileURL } from "node:url";
import {
  getPrismaClientForJob,
  isMultiTenantMode,
  disconnectAllTenantClients,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import type { AuditLogJobData } from "../lib/services/auditLog";

/**
 * Process an audit log job.
 * Writes the audit event to the database.
 */
const processor = async (job: Job<AuditLogJobData>) => {
  const { event, context, queuedAt } = job.data;

  console.log(
    `[AuditLogWorker] Processing audit event: ${event.action} ${event.entityType}:${event.entityId}${
      job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""
    }`
  );

  // Validate multi-tenant job data if in multi-tenant mode
  validateMultiTenantJobData(job.data);

  // Get the appropriate Prisma client (tenant-specific or default)
  const prisma = getPrismaClientForJob(job.data);

  try {
    // Merge user info from event (explicit) and context (request-level)
    const userId = event.userId || context?.userId || null;
    const userEmail = event.userEmail || context?.userEmail || null;
    const userName = event.userName || context?.userName || null;

    // Build metadata combining context and event metadata
    const metadata: Record<string, unknown> = {
      ...(event.metadata || {}),
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      queuedAt,
      processedAt: new Date().toISOString(),
    };

    // Remove undefined values from metadata
    for (const key of Object.keys(metadata)) {
      if (metadata[key] === undefined) {
        delete metadata[key];
      }
    }

    // Validate projectId exists before creating audit log to prevent foreign key constraint errors
    // The project might have been deleted between when the event was queued and now
    let validatedProjectId: number | null = null;
    if (event.projectId) {
      const projectExists = await prisma.projects.findUnique({
        where: { id: event.projectId },
        select: { id: true },
      });
      if (projectExists) {
        validatedProjectId = event.projectId;
      } else {
        // Project no longer exists - store the original projectId in metadata for reference
        metadata.originalProjectId = event.projectId;
        console.warn(
          `[AuditLogWorker] Project ${event.projectId} no longer exists, creating audit log without project association`
        );
      }
    }

    // Create the audit log entry
    // Note: We use the raw Prisma client here to bypass ZenStack access control
    // since audit logs should be created by the system, not by users directly
    await prisma.auditLog.create({
      data: {
        userId,
        userEmail,
        userName,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        entityName: event.entityName || null,
        changes: event.changes as Prisma.InputJsonValue | undefined,
        metadata: Object.keys(metadata).length > 0 ? (metadata as Prisma.InputJsonValue) : undefined,
        projectId: validatedProjectId,
      },
    });

    console.log(
      `[AuditLogWorker] Successfully logged: ${event.action} ${event.entityType}:${event.entityId}`
    );
  } catch (error) {
    console.error(`[AuditLogWorker] Failed to create audit log:`, error);
    throw error; // Re-throw to trigger retry
  }
};

let worker: Worker | null = null;

/**
 * Start the audit log worker.
 */
const startWorker = async () => {
  // Log multi-tenant mode status
  if (isMultiTenantMode()) {
    console.log("[AuditLogWorker] Starting in MULTI-TENANT mode");
  } else {
    console.log("[AuditLogWorker] Starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    worker = new Worker(AUDIT_LOG_QUEUE_NAME, processor, {
      connection: valkeyConnection,
      concurrency: 10, // Higher concurrency since audit logs are independent
    });

    worker.on("completed", (job) => {
      // Don't log every completion to avoid noise
      // console.log(`[AuditLogWorker] Job ${job.id} completed`);
    });

    worker.on("failed", (job, err) => {
      console.error(`[AuditLogWorker] Job ${job?.id} failed:`, err);
    });

    worker.on("error", (err) => {
      console.error("[AuditLogWorker] Worker error:", err);
    });

    console.log(`[AuditLogWorker] Started for queue "${AUDIT_LOG_QUEUE_NAME}"`);
  } else {
    console.warn(
      "[AuditLogWorker] Valkey connection not available. Worker not started."
    );
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("[AuditLogWorker] Shutting down...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("[AuditLogWorker] Received SIGTERM, shutting down...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};

// Run the worker if this file is executed directly
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  (typeof import.meta === "undefined" ||
    (import.meta as unknown as { url?: string })?.url === undefined)
) {
  console.log("[AuditLogWorker] Running as standalone process...");
  startWorker().catch((err) => {
    console.error("[AuditLogWorker] Failed to start:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
