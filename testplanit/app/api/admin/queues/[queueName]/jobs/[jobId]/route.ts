import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantDb";
import { baseDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import {
  enrichFromApiAuth,
  withAuditContext,
} from "~/lib/auditContextWrappers";
import { auditSystemConfigChange } from "~/lib/services/auditLog";
import { cancelFlagsForJob } from "~/lib/services/jobCancel";
import {
  ActiveJobError,
  cancelJob,
  getQueueByName,
  NotCancellableError,
  removeJob,
} from "~/lib/services/queueAdmin";
import { getServerAuthSession } from "~/server/auth";

// Helper to check admin authentication (session or API token)
async function checkAdminAuth(
  request: NextRequest
): Promise<{ error?: NextResponse; userId?: string }> {
  const session = await getServerAuthSession();
  let userId = session?.user?.id;
  let userAccess: string | undefined;

  if (!userId) {
    const apiAuth = await authenticateApiToken(request);
    if (!apiAuth.authenticated) {
      return {
        error: NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        ),
      };
    }
    userId = apiAuth.userId;
    userAccess = apiAuth.access;

    if (apiAuth.userId) {
      enrichFromApiAuth({
        userId: apiAuth.userId,
        userName: apiAuth.userName,
        userEmail: apiAuth.userEmail,
      });
    }
  }

  if (!userId) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!userAccess) {
    const user = await baseDb.user.findUnique({
      where: { id: userId },
      select: { access: true },
    });
    userAccess = user?.access;
  }

  if (userAccess !== "ADMIN") {
    return {
      error: NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      ),
    };
  }

  return { userId };
}

/**
 * Check if job belongs to the current tenant
 * In single-tenant mode, always returns true
 * In multi-tenant mode, checks job.data.tenantId matches current instance
 * @throws Error if in multi-tenant mode but no tenant ID is configured
 */
function jobBelongsToCurrentTenant(job: any): boolean {
  const multiTenant = isMultiTenantMode();
  const currentTenantId = getCurrentTenantId();

  if (!multiTenant) {
    return true; // Single-tenant mode
  }

  // In multi-tenant mode, tenant ID must be configured
  if (!currentTenantId) {
    throw new Error(
      "Multi-tenant mode enabled but INSTANCE_TENANT_ID not configured"
    );
  }

  return job.data?.tenantId === currentTenantId;
}

/**
 * A remove or cancel the queue refused. 409 for a job a worker holds (the
 * page offers Cancel when the job's processor honours a flag), 400 for a
 * cancel the job cannot take.
 */
function refusal(error: unknown): NextResponse | null {
  if (error instanceof ActiveJobError) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        active: true,
        cancellable: error.cancellable,
        scheduleRemoved: error.scheduleRemoved,
      },
      { status: 409 }
    );
  }
  if (error instanceof NotCancellableError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 }
    );
  }
  return null;
}

// GET: Get detailed information about a specific job
export const GET = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ queueName: string; jobId: string }> }
  ) => {
    try {
      const auth = await checkAdminAuth(request);
      if (auth.error) return auth.error;

      const { queueName, jobId } = await params;
      const queue = getQueueByName(queueName);

      if (!queue) {
        return NextResponse.json({ error: "Queue not found" }, { status: 404 });
      }

      const job = await queue.getJob(jobId);

      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      // Check tenant access in multi-tenant mode
      if (!jobBelongsToCurrentTenant(job)) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      const state = await job.getState();
      const logs = await queue.getJobLogs(jobId);

      return NextResponse.json({
        job: {
          id: job.id,
          name: job.name,
          data: job.data,
          opts: job.opts,
          progress: job.progress,
          returnvalue: job.returnvalue,
          stacktrace: job.stacktrace,
          timestamp: job.timestamp,
          attemptsMade: job.attemptsMade,
          failedReason: job.failedReason,
          finishedOn: job.finishedOn,
          processedOn: job.processedOn,
          state,
          cancellable: cancelFlagsForJob(queueName, job) !== null,
          logs,
        },
      });
    } catch (error: any) {
      console.error("Error fetching job details:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);

// POST: Perform actions on a specific job (retry, promote, remove, cancel)
export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ queueName: string; jobId: string }> }
  ) => {
    try {
      const auth = await checkAdminAuth(request);
      if (auth.error) return auth.error;

      const { queueName, jobId } = await params;
      const queue = getQueueByName(queueName);

      if (!queue) {
        return NextResponse.json({ error: "Queue not found" }, { status: 404 });
      }

      const job = await queue.getJob(jobId);

      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      // Check tenant access in multi-tenant mode
      if (!jobBelongsToCurrentTenant(job)) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      const { action, force = false } = await request.json();

      switch (action) {
        case "retry":
          await job.retry();
          // Audit the admin job-retry operator action.
          await auditSystemConfigChange(
            `queue.${queueName}.job.${jobId}.retry`,
            null,
            {
              queueName,
              jobId,
              action: "retry",
              triggeredBy: auth.userId ?? "unknown",
            }
          );
          return NextResponse.json({ success: true, message: "Job retried" });

        case "promote":
          await job.promote();
          // Audit the admin job-promote operator action.
          await auditSystemConfigChange(
            `queue.${queueName}.job.${jobId}.promote`,
            null,
            {
              queueName,
              jobId,
              action: "promote",
              triggeredBy: auth.userId ?? "unknown",
            }
          );
          return NextResponse.json({ success: true, message: "Job promoted" });

        case "remove": {
          // Only a removal that happened is audited or reported as one.
          await removeJob(queue, queueName, job, force);
          await auditSystemConfigChange(
            `queue.${queueName}.job.${jobId}.remove`,
            null,
            {
              queueName,
              jobId,
              action: "remove",
              triggeredBy: auth.userId ?? "unknown",
              force,
            }
          );
          return NextResponse.json({ success: true, message: "Job removed" });
        }

        case "cancel": {
          const outcome = await cancelJob(queue, queueName, job);
          await auditSystemConfigChange(
            `queue.${queueName}.job.${jobId}.cancel`,
            null,
            {
              queueName,
              jobId,
              action: "cancel",
              triggeredBy: auth.userId ?? "unknown",
              removed: outcome.removed,
            }
          );
          return NextResponse.json({
            success: true,
            ...outcome,
            message: outcome.removed
              ? "Job removed before it started"
              : "Cancel requested; the job stops at its next check",
          });
        }

        default:
          return NextResponse.json(
            { error: "Invalid action" },
            { status: 400 }
          );
      }
    } catch (error: any) {
      const refused = refusal(error);
      if (refused) return refused;
      console.error("Error performing job action:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);

// DELETE: Remove a specific job
export const DELETE = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ queueName: string; jobId: string }> }
  ) => {
    try {
      const auth = await checkAdminAuth(request);
      if (auth.error) return auth.error;

      const { queueName, jobId } = await params;
      const queue = getQueueByName(queueName);

      if (!queue) {
        return NextResponse.json({ error: "Queue not found" }, { status: 404 });
      }

      const job = await queue.getJob(jobId);

      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      // Check tenant access in multi-tenant mode
      if (!jobBelongsToCurrentTenant(job)) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

      // Check for force parameter in query string
      const { searchParams } = new URL(request.url);
      const force = searchParams.get("force") === "true";

      // Only a removal that happened is audited or reported as one.
      await removeJob(queue, queueName, job, force);
      await auditSystemConfigChange(
        `queue.${queueName}.job.${jobId}.delete`,
        null,
        {
          queueName,
          jobId,
          action: "delete",
          triggeredBy: auth.userId ?? "unknown",
          force,
        }
      );

      return NextResponse.json({ success: true, message: "Job removed" });
    } catch (error: any) {
      const refused = refusal(error);
      if (refused) return refused;
      console.error("Error removing job:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);
