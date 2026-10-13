import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { getImpactAnalysisQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

function parseIds(rawProject: string, rawAnalysis: string) {
  const projectId = Number(rawProject);
  const analysisId = Number(rawAnalysis);
  if (!Number.isInteger(projectId) || !Number.isInteger(analysisId)) {
    return null;
  }
  return { projectId, analysisId };
}

/**
 * GET /api/projects/[projectId]/impact/analyses/[analysisId]
 * The analysis row, its scored cases (joined to case name/folder), and the
 * live job progress while it is still queued or running.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; analysisId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolved = await params;
  const ids = parseIds(resolved.projectId, resolved.analysisId);
  if (!ids) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const db = await getEnhancedDb(session);
    const row = await db.impactAnalysis.findFirst({
      where: { id: ids.analysisId, projectId: ids.projectId, isDeleted: false },
      include: {
        createdBy: { select: { id: true, name: true } },
        config: {
          select: {
            id: true,
            branch: true,
            repositoryId: true,
            repository: { select: { id: true, name: true, provider: true } },
          },
        },
        cases: {
          orderBy: [{ score: "desc" }, { caseId: "asc" }],
          include: {
            case: {
              select: {
                id: true,
                name: true,
                automated: true,
                isArchived: true,
                isDeleted: true,
                folder: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!row) {
      return NextResponse.json(
        { error: "Analysis not found" },
        { status: 404 }
      );
    }

    let progress: unknown = null;
    let jobState: string | null = null;
    if ((row.status === "PENDING" || row.status === "RUNNING") && row.jobId) {
      const queue = getImpactAnalysisQueue();
      const job = queue ? await queue.getJob(row.jobId) : null;
      const tenantOk =
        !isMultiTenantMode() ||
        (job?.data as { tenantId?: string } | undefined)?.tenantId ===
          getCurrentTenantId();
      if (job && tenantOk) {
        jobState = await job.getState();
        progress = job.progress;
      }
    }

    const { cases, ...analysis } = row;
    return NextResponse.json({ analysis, cases, progress, jobState });
  } catch (error) {
    console.error("Impact analysis read error:", error);
    return NextResponse.json(
      { error: "Failed to load analysis" },
      { status: 500 }
    );
  }
}
