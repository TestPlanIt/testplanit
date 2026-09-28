import { baseDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiToken } from "~/lib/api-token-auth";
import {
  enrichFromApiAuth,
  withAuditContext,
} from "~/lib/auditContextWrappers";
import { auditSystemConfigChange } from "~/lib/services/auditLog";
import {
  ActiveJobError,
  getQueueByName,
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

// POST: Perform actions on the queue (pause, resume, clean, drain, obliterate)
export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ queueName: string }> }
  ) => {
    try {
      const auth = await checkAdminAuth(request);
      if (auth.error) return auth.error;

      const { queueName } = await params;
      const queue = getQueueByName(queueName);

      if (!queue) {
        return NextResponse.json({ error: "Queue not found" }, { status: 404 });
      }

      const {
        action,
        grace,
        limit,
        jobTypes: _jobTypes,
      } = await request.json();

      switch (action) {
        case "pause":
          await queue.pause();
          // Audit the admin queue operator action.
          await auditSystemConfigChange(`queue.${queueName}.pause`, null, {
            queueName,
            action: "pause",
            triggeredBy: auth.userId ?? "unknown",
          });
          return NextResponse.json({ success: true, message: "Queue paused" });

        case "resume":
          await queue.resume();
          // Audit the admin queue operator action.
          await auditSystemConfigChange(`queue.${queueName}.resume`, null, {
            queueName,
            action: "resume",
            triggeredBy: auth.userId ?? "unknown",
          });
          return NextResponse.json({ success: true, message: "Queue resumed" });

        case "clean":
          // Clean completed and failed jobs
          const cleanOptions = {
            grace: grace || 0, // Grace period in milliseconds
            limit: limit || 100, // Max number of jobs to clean
          };

          const completedCleaned = await queue.clean(
            cleanOptions.grace,
            cleanOptions.limit,
            "completed"
          );
          const failedCleaned = await queue.clean(
            cleanOptions.grace,
            cleanOptions.limit,
            "failed"
          );

          // Audit the admin queue clean operator action.
          await auditSystemConfigChange(`queue.${queueName}.clean`, null, {
            queueName,
            action: "clean",
            triggeredBy: auth.userId ?? "unknown",
            cleaned: {
              completed: completedCleaned.length,
              failed: failedCleaned.length,
            },
          });

          return NextResponse.json({
            success: true,
            message: "Queue cleaned",
            cleaned: {
              completed: completedCleaned.length,
              failed: failedCleaned.length,
              total: completedCleaned.length + failedCleaned.length,
            },
          });

        case "drain":
          // Remove all waiting jobs
          await queue.drain();
          // Audit the admin queue drain operator action.
          await auditSystemConfigChange(`queue.${queueName}.drain`, null, {
            queueName,
            action: "drain",
            triggeredBy: auth.userId ?? "unknown",
          });
          return NextResponse.json({
            success: true,
            message: "Queue drained (all waiting jobs removed)",
          });

        case "obliterate":
          // DANGEROUS: Completely wipe the queue
          await queue.obliterate({ force: true });
          // Audit the admin queue obliterate operator action.
          await auditSystemConfigChange(`queue.${queueName}.obliterate`, null, {
            queueName,
            action: "obliterate",
            triggeredBy: auth.userId ?? "unknown",
          });
          return NextResponse.json({
            success: true,
            message: "Queue obliterated (all data removed)",
          });

        default:
          return NextResponse.json(
            { error: "Invalid action" },
            { status: 400 }
          );
      }
    } catch (error: any) {
      console.error("Error performing queue action:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);

// DELETE: Remove a specific job from the queue
export const DELETE = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ queueName: string }> }
  ) => {
    try {
      const auth = await checkAdminAuth(request);
      if (auth.error) return auth.error;

      const { queueName } = await params;
      const queue = getQueueByName(queueName);

      if (!queue) {
        return NextResponse.json({ error: "Queue not found" }, { status: 404 });
      }

      const { searchParams } = new URL(request.url);
      const jobId = searchParams.get("jobId");
      const force = searchParams.get("force") === "true";

      if (!jobId) {
        return NextResponse.json(
          { error: "Job ID is required" },
          { status: 400 }
        );
      }

      const job = await queue.getJob(jobId);
      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }

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
      console.error("Error removing job:", error);
      return NextResponse.json(
        { error: error.message || "Internal server error" },
        { status: 500 }
      );
    }
  }
);
