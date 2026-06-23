import type { Prisma } from "@prisma/client";
import { Job, Worker } from "bullmq";
import {
  disconnectAllTenantClients,
  getAllTenantIds,
  getPrismaClientForJob,
  getTenantPrismaClient,
  isMultiTenantMode,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { AUDIT_LOG_QUEUE_NAME } from "../lib/queues";
import { SYSTEM_ACTOR_ID } from "../lib/auditContextConstants";
import type { AuditLogJobData } from "../lib/services/auditLog";
import {
  PROJECT_SCOPED_ENTITY_TYPES,
  resolveAuditEntityScope,
} from "../lib/services/auditLog";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import {
  pollDataChangeLogsAcrossTenants,
  type TenantPollClient,
} from "../lib/audit/correlation";
import { ensureAuditTriggers } from "../lib/audit/ensureAuditTriggers";

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
    let userEmail = event.userEmail || context?.userEmail || null;
    let userName = event.userName || context?.userName || null;

    // Backfill the actor's display fields from the user record when only an id
    // made it onto the event. This happens whenever a caller invokes
    // captureAuditEvent() with just `userId` outside of a withAuditContext()
    // request (e.g. some API routes and background jobs that carry only the
    // actor id) — without this the row would persist with a blank User/Email.
    // Best-effort and skipped for the system sentinel: a lookup failure or a
    // since-deleted user must never block the audit write. A plain id lookup
    // (no soft-delete filter) intentionally still resolves names for users
    // removed after the event so historical rows stay attributable.
    if (userId && userId !== SYSTEM_ACTOR_ID && (!userEmail || !userName)) {
      try {
        const actor = await prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, name: true },
        });
        if (actor) {
          userEmail = userEmail || actor.email || null;
          userName = userName || actor.name || null;
        }
      } catch (lookupError) {
        console.warn(
          `[AuditLogWorker] Could not backfill actor details for user ${userId}:`,
          lookupError
        );
      }
    }

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

    // Backfill a missing display name and/or project scope from the committed
    // row. Emitters that mutate through the ZenStack RPC route only see a
    // partial `{ id }` result (it injects `select: { id: true }`), so the
    // inline name/projectId resolution lands as null; rows project-scoped only
    // through a parent relation (TestRunCases, results) likewise arrive without
    // a scalar projectId. This worker runs after the mutation has committed, so
    // a fresh read on a separate connection always sees the row — the one place
    // every emitter can be reconciled. Best-effort: a lookup miss leaves the gap
    // as-is rather than blocking the audit write.
    let resolvedEntityName: string | null = event.entityName || null;
    let resolvedProjectId: number | null = event.projectId ?? null;
    const needName = !resolvedEntityName;
    const needProjectId =
      resolvedProjectId == null &&
      PROJECT_SCOPED_ENTITY_TYPES.has(event.entityType);
    if (needName || needProjectId) {
      try {
        const scope = await resolveAuditEntityScope(
          prisma as never,
          event.entityType,
          event.entityId,
          { needName, needProjectId }
        );
        if (needName && scope.entityName) resolvedEntityName = scope.entityName;
        if (needProjectId && scope.projectId != null) {
          resolvedProjectId = scope.projectId;
        }
      } catch (scopeError) {
        console.warn(
          `[AuditLogWorker] Could not backfill scope for ${event.entityType}:${event.entityId}:`,
          scopeError
        );
      }
    }

    // Validate projectId exists before creating audit log to prevent foreign key constraint errors
    // The project might have been deleted between when the event was queued and now
    let validatedProjectId: number | null = null;
    if (resolvedProjectId != null) {
      const projectExists = await prisma.projects.findUnique({
        where: { id: resolvedProjectId },
        select: { id: true },
      });
      if (projectExists) {
        validatedProjectId = resolvedProjectId;
      } else {
        // Project no longer exists - store the original projectId in metadata for reference
        metadata.originalProjectId = resolvedProjectId;
        console.warn(
          `[AuditLogWorker] Project ${resolvedProjectId} no longer exists, creating audit log without project association`
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
        entityName: resolvedEntityName,
        changes: event.changes as Prisma.InputJsonValue | undefined,
        metadata:
          Object.keys(metadata).length > 0
            ? (metadata as Prisma.InputJsonValue)
            : undefined,
        projectId: validatedProjectId,
        // Stamp the per-operation correlation id from the request's audit
        // context so an aggregate semantic event (BULK_*, DUPLICATED,
        // ITERATION_*) groups in the UI as the header of the CDC per-row detail
        // rows that share the same operationId, instead of floating separately.
        // Events with no X-Operation-Id (login, export, …) carry null and are
        // unaffected.
        operationId: context?.operationId ?? null,
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
 * Loop B (CDC consumer) lifecycle. `running` is the single stop signal flipped false by the
 * SIGINT/SIGTERM handlers — pollDataChangeLogsAcrossTenants checks it at each iteration boundary and exits
 * cleanly (any half-processed batch is left processed=false for the next start; the idempotent
 * insert handles re-materialization safely). `loopBPromise` lets shutdown await a clean stop.
 */
const correlationRunning = { running: false };
let loopBPromise: Promise<void> | null = null;

/**
 * Loop B correlation targets. DataChangeLog lives in every tenant database (capture triggers are
 * applied per-DB), so the consumer must drain each one into its own AuditLog. Single-tenant: the raw
 * prismaBase client (the sole authorized DataChangeLog reader — it bypasses the @@deny('all', true)
 * policy by design). Multi-tenant: one raw client per configured tenant, re-resolved each cycle so a
 * tenant added at runtime is picked up without a worker restart. getTenantPrismaClient returns a
 * cached vanilla PrismaClient per tenant, which satisfies the raw-client surface correlation needs
 * (raw SQL on DataChangeLog + policy-free model lookups for humanization).
 */
function listCorrelationClients(): TenantPollClient[] {
  if (!isMultiTenantMode()) {
    return [
      {
        tenantId: undefined,
        client: getPrismaClientForJob({ tenantId: undefined }),
      },
    ];
  }
  return getAllTenantIds().map((tenantId) => ({
    tenantId,
    client: getTenantPrismaClient(tenantId),
  }));
}

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
    worker = new Worker(AUDIT_LOG_QUEUE_NAME, withTenantContext(processor), {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: parseInt(process.env.AUDIT_LOG_CONCURRENCY || "10", 10), // Higher concurrency since audit logs are independent
    });

    worker.on("completed", (_job) => {
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

  // Loop B (CDC consumer): drains DataChangeLog → AuditLog in a restart-safe polling loop ALONGSIDE
  // the BullMQ consumer above (Loop A). It only needs the DB (no Valkey), so it starts regardless of
  // the Valkey branch. In multi-tenant mode it polls EVERY configured tenant's database per cycle
  // (re-resolved each pass so runtime tenant additions are picked up); in single-tenant mode it
  // polls the one prismaBase client. Each client is the sole authorized DataChangeLog reader for its
  // database — it bypasses the @@deny('all', true) policy by design, the same raw-client pattern the
  // BullMQ processor uses above. Fire-and-forget against the running flag; the process stays alive on
  // the BullMQ worker (Loop A) and/or this loop's own event loop.
  correlationRunning.running = true;
  loopBPromise = pollDataChangeLogsAcrossTenants(
    listCorrelationClients,
    correlationRunning
  ).catch((err) => {
    console.error("[AuditLogWorker] CDC poll loop (Loop B) crashed:", err);
  });
  console.log(
    `[AuditLogWorker] Started CDC poll loop (Loop B)${
      isMultiTenantMode()
        ? ` across ${getAllTenantIds().length} tenant database(s)`
        : ""
    } for DataChangeLog → AuditLog materialization`
  );

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("[AuditLogWorker] Shutting down...");
    // Stop Loop B at its next iteration boundary, then await its clean exit (a half-processed
    // batch is left processed=false for the next start — the idempotent insert handles re-run).
    correlationRunning.running = false;
    if (loopBPromise) {
      await loopBPromise;
    }
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
    correlationRunning.running = false;
    if (loopBPromise) {
      await loopBPromise;
    }
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("[AuditLogWorker] Running as standalone process...");
  // Re-attach the audit-trigger substrate before draining DataChangeLog. The web tier's
  // instrumentation hook does this too, but workers can boot first (or the web pod can fail its
  // startup asserts), and this worker is the direct consumer of the capture triggers — if they were
  // dropped (by `prisma db push`, or a launch path that skips apply-triggers) it would silently
  // drain nothing. Idempotent and advisory-locked; fail-open by default so a DDL hiccup can't
  // crash-loop the worker — set AUDIT_TRIGGER_BOOTSTRAP_FATAL=1 to refuse to start without it.
  void (async () => {
    try {
      await ensureAuditTriggers();
      await startWorker();
    } catch (err) {
      console.error("[AuditLogWorker] Failed to start:", err);
      process.exit(1);
    }
  })();
}

export default worker;
export { processor, startWorker };
