import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { prisma } from "@/lib/prisma";
import { getElasticsearchReindexQueue } from "@/lib/queues";
import { isMultiTenantMode, getCurrentTenantId } from "@/lib/multiTenantPrisma";

// Helper to check admin authentication (session or API token)
async function checkAdminAuth(request: NextRequest): Promise<{ error?: NextResponse; userId?: string }> {
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
  }

  if (!userId) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!userAccess) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { access: true },
    });
    userAccess = user?.access;
  }

  if (userAccess !== "ADMIN") {
    return {
      error: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    };
  }

  return { userId };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const auth = await checkAdminAuth(request);
    if (auth.error) return auth.error;

    // Check if queue is available
    const elasticsearchReindexQueue = getElasticsearchReindexQueue();
    if (!elasticsearchReindexQueue) {
      return NextResponse.json(
        {
          error: "Background job queue is not available",
        },
        { status: 503 }
      );
    }

    const { jobId } = await params;
    const job = await elasticsearchReindexQueue.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Check tenant access in multi-tenant mode
    if (isMultiTenantMode()) {
      const currentTenantId = getCurrentTenantId();

      // In multi-tenant mode, tenant ID must be configured
      if (!currentTenantId) {
        return NextResponse.json(
          { error: "Multi-tenant mode enabled but tenant ID not configured" },
          { status: 500 }
        );
      }

      if (job.data?.tenantId !== currentTenantId) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
    }

    const state = await job.getState();
    const progress = job.progress;

    // Get job logs from Redis
    const logsKey = `bull:${elasticsearchReindexQueue.name}:${jobId}:logs`;
    const connection = await elasticsearchReindexQueue.client;
    const logs = await connection.lrange(logsKey, 0, -1);

    let result = null;
    let failedReason = null;

    if (state === "completed") {
      result = job.returnvalue;
    } else if (state === "failed") {
      failedReason = job.failedReason;
    }

    return NextResponse.json({
      jobId: job.id,
      state,
      progress,
      logs: logs || [],
      result,
      failedReason,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    });
  } catch (error: any) {
    console.error("Job status error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
