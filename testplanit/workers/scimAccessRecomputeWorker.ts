import { Job, Worker } from "bullmq";

import { runWithAuditContext } from "../lib/auditContext";
import {
  disconnectAllTenantClients,
  isMultiTenantMode,
  type MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { baseDb } from "../lib/db";
import { SCIM_ACCESS_RECOMPUTE_QUEUE_NAME } from "../lib/queueNames";
import {
  readScimFallbackDefault,
  recomputeUserAccess,
} from "../lib/scim/services/recompute";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";

// ─── Job data type ───────────────────────────────────────────────────────────

export interface ScimAccessRecomputeJobData extends MultiTenantJobData {
  /**
   * When present: recompute only the members of this group.
   * When absent: recompute all users whose access is governed by group mapping
   * (accessSource === GROUP_MAPPING) — used when the fallback default changes.
   */
  groupId?: number;
  /**
   * The admin user who triggered the mapping/fallback change.
   * Stamped into the audit frame so access-change rows are attributable even
   * though the worker has no ALS frame from the original request.
   */
  adminUserId: string;
}

// ─── Processor ───────────────────────────────────────────────────────────────

export const processor = async (
  job: Job<ScimAccessRecomputeJobData>
): Promise<void> => {
  const { groupId, adminUserId } = job.data;

  console.log(
    `Processing scim-access-recompute job ${job.id}` +
      (groupId != null
        ? ` for group ${groupId}`
        : " (fallback-default sweep)") +
      ` triggered by admin ${adminUserId}`
  );

  validateMultiTenantJobData(job.data);

  const BATCH_SIZE = 100;

  await runWithAuditContext(
    {
      userId: adminUserId,
      scimGroupId: groupId != null ? String(groupId) : undefined,
      scimTokenId: "worker:scim-access-recompute",
    },
    async () => {
      if (groupId != null) {
        const members = await baseDb.groupAssignment.findMany({
          where: { groupId },
          select: { userId: true },
        });

        for (let i = 0; i < members.length; i += BATCH_SIZE) {
          const batch = members.slice(i, i + BATCH_SIZE);
          await baseDb.$transaction(async (tx) => {
            const fallbackDefault = await readScimFallbackDefault(tx);
            for (const { userId } of batch) {
              await recomputeUserAccess(tx, userId, fallbackDefault);
            }
          });
        }
      } else {
        // Fallback-default sweep: recompute every group-mapped user. Fetch the
        // ids up front and batch the recompute the same way the group path
        // does (BATCH_SIZE/tx) so a large directory can't run as one unbounded
        // transaction holding locks for the whole sweep. Per-user recompute is
        // idempotent, so a mid-sweep failure is safe to retry from the top.
        const users = await baseDb.user.findMany({
          where: { accessSource: "GROUP_MAPPING", isDeleted: false },
          select: { id: true },
        });

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
          const batch = users.slice(i, i + BATCH_SIZE);
          await baseDb.$transaction(async (tx) => {
            const fallbackDefault = await readScimFallbackDefault(tx);
            for (const { id } of batch) {
              await recomputeUserAccess(tx, id, fallbackDefault);
            }
          });
        }
      }
    }
  );
};

// ─── Worker setup ────────────────────────────────────────────────────────────

let worker: Worker<ScimAccessRecomputeJobData, void> | null = null;

export function startScimAccessRecomputeWorker() {
  if (isMultiTenantMode()) {
    console.log("SCIM access recompute worker starting in MULTI-TENANT mode");
  } else {
    console.log("SCIM access recompute worker starting in SINGLE-TENANT mode");
  }

  worker = new Worker<ScimAccessRecomputeJobData, void>(
    SCIM_ACCESS_RECOMPUTE_QUEUE_NAME,
    withTenantContext(processor),
    {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) =>
    console.log(`SCIM access recompute job ${job.id} completed`)
  );
  worker.on("failed", (job, err) =>
    console.error(`SCIM access recompute job ${job?.id} failed:`, err.message)
  );
  worker.on("error", (err) => {
    console.error("SCIM access recompute worker error:", err);
  });

  console.log(
    `SCIM access recompute worker started for queue "${SCIM_ACCESS_RECOMPUTE_QUEUE_NAME}".`
  );

  process.on("SIGTERM", async () => {
    console.log("Shutting down SCIM access recompute worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down SCIM access recompute worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  return worker;
}

if (require.main === module) {
  console.log("SCIM access recompute worker running...");
  startScimAccessRecomputeWorker();
}

export default worker;
