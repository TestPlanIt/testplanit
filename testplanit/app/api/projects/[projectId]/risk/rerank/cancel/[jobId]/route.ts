import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { getRiskScoreQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

/**
 * POST /api/projects/[projectId]/risk/rerank/cancel/[jobId]
 *
 * Drops a re-rank the user no longer wants. A job already running is left to
 * finish — BullMQ cannot interrupt a provider call in flight — and the
 * dialog simply stops listening for it.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; jobId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { projectId: rawProject, jobId } = await context.params;
  const projectId = Number(rawProject);
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  try {
    const queue = getRiskScoreQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 }
      );
    }
    const job = await queue.getJob(jobId);
    const notFound = NextResponse.json(
      { error: "Job not found" },
      { status: 404 }
    );
    if (!job) return notFound;
    if (isMultiTenantMode() && job.data?.tenantId !== getCurrentTenantId()) {
      return notFound;
    }
    if (
      job.data?.projectId !== projectId ||
      job.data?.userId !== session.user.id
    ) {
      return notFound;
    }

    const state = await job.getState();
    if (state === "waiting" || state === "delayed" || state === "prioritized") {
      await job.remove();
      return NextResponse.json({ cancelled: true });
    }
    return NextResponse.json({ cancelled: false, state });
  } catch (error) {
    console.error("[risk-rerank] cancel failed:", error);
    return NextResponse.json(
      { error: "Failed to cancel the re-rank" },
      { status: 500 }
    );
  }
}
