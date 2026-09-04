import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { getImpactAnalysisQueue } from "~/lib/queues";
import { impactCancelKey } from "~/lib/services/impact/jobKeys";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

/**
 * POST /api/projects/[projectId]/impact/analyses/[analysisId]/cancel
 * Creator or project admin only. A waiting job is removed; an active one
 * gets the Redis cancel flag the worker checks between phases and batches.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; analysisId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolved = await params;
  const projectId = Number(resolved.projectId);
  const analysisId = Number(resolved.analysisId);
  if (!Number.isInteger(projectId) || !Number.isInteger(analysisId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const db = await getEnhancedDb(session);
    const row = await db.impactAnalysis.findFirst({
      where: { id: analysisId, projectId, isDeleted: false },
      select: { id: true, status: true, jobId: true, createdById: true },
    });
    if (!row) {
      return NextResponse.json(
        { error: "Analysis not found" },
        { status: 404 }
      );
    }
    if (row.createdById !== session.user.id) {
      const admin = await authorizeProjectAdminForProject(session, projectId);
      if (!admin.ok) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    if (row.status !== "PENDING" && row.status !== "RUNNING") {
      return NextResponse.json({ message: "Analysis already finished" });
    }

    const queue = getImpactAnalysisQueue();
    const job = queue && row.jobId ? await queue.getJob(row.jobId) : null;
    const tenantOk =
      !isMultiTenantMode() ||
      (job?.data as { tenantId?: string } | undefined)?.tenantId ===
        getCurrentTenantId();

    if (!job || !tenantOk) {
      await db.impactAnalysis.update({
        where: { id: analysisId },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
      return NextResponse.json({ message: "Analysis cancelled" });
    }

    const state = await job.getState();
    if (state === "waiting" || state === "delayed" || state === "prioritized") {
      await job.remove();
      await db.impactAnalysis.update({
        where: { id: analysisId },
        data: { status: "CANCELLED", completedAt: new Date() },
      });
      return NextResponse.json({ message: "Analysis cancelled" });
    }
    if (state === "completed" || state === "failed") {
      return NextResponse.json({ message: "Analysis already finished" });
    }

    const connection = await queue!.client;
    await connection.set(impactCancelKey(job.id as string), "1", { EX: 3600 });
    return NextResponse.json({
      message:
        "Cancellation requested, the analysis will stop at the next phase",
    });
  } catch (error) {
    if (isAccessPolicyError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Impact analysis cancel error:", error);
    return NextResponse.json(
      { error: "Failed to cancel analysis" },
      { status: 500 }
    );
  }
}
