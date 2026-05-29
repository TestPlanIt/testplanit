import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantPrisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getGenerateFromUrlQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const queue = getGenerateFromUrlQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 }
      );
    }

    const { jobId } = await params;
    const job = await queue.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Multi-tenant isolation
    if (isMultiTenantMode()) {
      const currentTenantId = getCurrentTenantId();
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

    // Only the user who submitted the job can cancel it
    if (job.data.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const state = await job.getState();

    // Already finished -- nothing to cancel
    if (state === "completed" || state === "failed") {
      return NextResponse.json({ message: "Job already finished" });
    }

    // Waiting in queue -- remove it directly
    if (state === "waiting" || state === "delayed") {
      await job.remove();
      return NextResponse.json({ message: "Job cancelled" });
    }

    // Active -- set Redis cancellation flag for worker to pick up between pages,
    // AND try to force-fail the job so it stops immediately even during a long LLM call
    const connection = await queue.client;
    await connection.set(`generate-from-url:cancel:${jobId}`, "1", { EX: 3600 });

    try {
      await job.moveToFailed(new Error("Job cancelled by user"), "0", true);
    } catch {
      // moveToFailed may fail if the job is locked by the worker — the Redis
      // cancel key will still be picked up between pages as a fallback
    }

    return NextResponse.json({
      message: "Cancellation requested",
    });
  } catch (error) {
    console.error("Generate from URL cancel error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
