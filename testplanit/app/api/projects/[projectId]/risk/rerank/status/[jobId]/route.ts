import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { getRiskScoreQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

/**
 * GET /api/projects/[projectId]/risk/rerank/status/[jobId]
 *
 * Polled by the dialog while a re-rank runs. A job of another tenant, of
 * another project, or started by someone else is reported as missing rather
 * than denied — the caller has no business knowing it exists.
 */
export async function GET(
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
    if (isMultiTenantMode()) {
      const tenantId = getCurrentTenantId();
      if (!tenantId) {
        return NextResponse.json(
          { error: "Multi-tenant mode enabled but tenant ID not configured" },
          { status: 500 }
        );
      }
      if (job.data?.tenantId !== tenantId) return notFound;
    }
    if (
      job.data?.projectId !== projectId ||
      job.data?.userId !== session.user.id
    ) {
      return notFound;
    }

    const state = await job.getState();
    // BullMQ hands the return value back as a string or an object depending
    // on how it was stored and read, and it can still be unset on the first
    // read after the state flips — one re-read closes that window, and the
    // dialog keeps polling if it is still empty.
    let raw = job.returnvalue;
    if (state === "completed" && raw == null) {
      raw = (await queue.getJob(jobId))?.returnvalue ?? null;
    }
    const result =
      state === "completed" && raw != null
        ? typeof raw === "string"
          ? JSON.parse(raw)
          : raw
        : null;
    if (state === "failed") {
      // Logged, not relayed: a provider's error text is for operators.
      console.error(`[risk-rerank] job ${job.id} failed:`, job.failedReason);
    }
    return NextResponse.json({
      jobId: job.id,
      state,
      result,
      failed: state === "failed",
    });
  } catch (error) {
    console.error("[risk-rerank] status failed:", error);
    return NextResponse.json(
      { error: "Failed to read the re-rank status" },
      { status: 500 }
    );
  }
}
