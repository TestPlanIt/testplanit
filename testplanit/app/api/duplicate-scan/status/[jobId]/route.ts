import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantPrisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getDuplicateScanQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const queue = getDuplicateScanQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 },
      );
    }

    const { jobId } = await params;
    const job = await queue.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Multi-tenant isolation: don't reveal job exists to other tenants
    if (isMultiTenantMode()) {
      const currentTenantId = getCurrentTenantId();
      if (!currentTenantId) {
        return NextResponse.json(
          { error: "Multi-tenant mode enabled but tenant ID not configured" },
          { status: 500 },
        );
      }
      if (job.data?.tenantId !== currentTenantId) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
    }

    const state = await job.getState();

    // BullMQ may return returnvalue as a JSON string or parsed object
    // depending on how it was stored/retrieved. Ensure it's always an object.
    let result = null;
    if (state === "completed" && job.returnvalue != null) {
      result =
        typeof job.returnvalue === "string"
          ? JSON.parse(job.returnvalue)
          : job.returnvalue;
    }

    return NextResponse.json({
      jobId: job.id,
      state,
      progress: job.progress,
      result,
      failedReason: state === "failed" ? job.failedReason : null,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    });
  } catch (error) {
    console.error("Duplicate scan status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
