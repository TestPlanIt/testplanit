import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { authenticateApiToken } from "~/lib/api-token-auth";
import { prisma } from "@/lib/prisma";
import { getAllQueues } from "@/lib/queues";
import { Queue, Job } from "bullmq";
import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantPrisma";

function getQueueByName(queueName: string): Queue | null {
  const allQueues = getAllQueues();
  const queueMap: Record<string, Queue | null> = {
    "forecast-updates": allQueues.forecastQueue,
    notifications: allQueues.notificationQueue,
    emails: allQueues.emailQueue,
    "issue-sync": allQueues.syncQueue,
    "testmo-imports": allQueues.testmoImportQueue,
    "elasticsearch-reindex": allQueues.elasticsearchReindexQueue,
  };
  return queueMap[queueName] ?? null;
}

// GET: Get jobs from a specific queue
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ queueName: string }> }
) {
  try {
    // Check authentication - try session first, then API token
    const session = await getServerAuthSession();
    let userId = session?.user?.id;
    let userAccess: string | undefined;

    if (!userId) {
      const apiAuth = await authenticateApiToken(request);
      if (!apiAuth.authenticated) {
        return NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        );
      }
      userId = apiAuth.userId;
      userAccess = apiAuth.access;
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!userAccess) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { access: true },
      });
      userAccess = user?.access;
    }

    if (userAccess !== "ADMIN") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const { queueName } = await params;
    const queue = getQueueByName(queueName);

    if (!queue) {
      return NextResponse.json({ error: "Queue not found" }, { status: 404 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state") || "all";
    const start = parseInt(searchParams.get("start") || "0");
    const end = parseInt(searchParams.get("end") || "50");

    // Get current tenant ID for filtering in multi-tenant mode
    const currentTenantId = getCurrentTenantId();
    const multiTenant = isMultiTenantMode();

    // In multi-tenant mode, tenant ID must be configured
    if (multiTenant && !currentTenantId) {
      return NextResponse.json(
        { error: "Multi-tenant mode enabled but tenant ID not configured" },
        { status: 500 }
      );
    }

    // Helper to filter jobs by tenant
    const filterByTenant = (jobs: Job[]): Job[] => {
      if (!multiTenant) {
        return jobs;
      }
      return jobs.filter((job) => job.data?.tenantId === currentTenantId);
    };

    let jobs: Job[];
    if (state === "all") {
      // Get jobs from all states
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getJobs(["waiting"], 0, 1000),
        queue.getJobs(["active"], 0, 1000),
        queue.getJobs(["completed"], 0, 1000),
        queue.getJobs(["failed"], 0, 1000),
        queue.getJobs(["delayed"], 0, 1000),
      ]);

      // Filter by tenant first, then apply pagination
      const allJobs = filterByTenant([
        ...waiting,
        ...active,
        ...completed,
        ...failed,
        ...delayed,
      ]);
      jobs = allJobs.slice(start, end);
    } else {
      const stateJobs = await queue.getJobs([state as any], 0, 1000);
      const filteredJobs = filterByTenant(stateJobs);
      jobs = filteredJobs.slice(start, end);
    }

    // Format jobs for response
    const formattedJobs = await Promise.all(
      jobs.map(async (job) => {
        const state = await job.getState();
        return {
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
        };
      })
    );

    return NextResponse.json({ jobs: formattedJobs });
  } catch (error: any) {
    console.error("Error fetching queue jobs:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
