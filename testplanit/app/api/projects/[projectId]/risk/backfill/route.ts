import { getCurrentTenantId, isMultiTenantMode } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { getRiskScoreQueue } from "~/lib/queues";
import {
  enqueueRiskProjectRecompute,
  riskProjectJobId,
} from "~/lib/services/risk/enqueue";
import { authOptions } from "~/server/auth";

type RouteContext = { params: Promise<{ projectId: string }> };

async function authorize(context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { projectId: raw } = await context.params;
  const projectId = Number(raw);
  if (!Number.isInteger(projectId)) {
    return {
      error: NextResponse.json({ error: "Invalid projectId" }, { status: 400 }),
    };
  }
  const admin = await authorizeProjectAdminForProject(session, projectId);
  if (!admin.ok) {
    return {
      error: NextResponse.json(
        { error: admin.error ?? "Forbidden" },
        { status: admin.status }
      ),
    };
  }
  return { session, projectId };
}

async function findRecomputeJob(projectId: number) {
  const queue = getRiskScoreQueue();
  if (!queue) return { queue: null, job: null };
  const job = await queue.getJob(
    riskProjectJobId(projectId, getCurrentTenantId())
  );
  if (!job) return { queue, job: null };
  const tenantOk =
    !isMultiTenantMode() ||
    (job.data as { tenantId?: string }).tenantId === getCurrentTenantId();
  return { queue, job: tenantOk ? job : null };
}

/** GET: state of the project's risk recompute job, if any. */
export async function GET(_req: NextRequest, context: RouteContext) {
  const auth = await authorize(context);
  if ("error" in auth) return auth.error;
  const { job } = await findRecomputeJob(auth.projectId);
  if (!job) return NextResponse.json({ state: "none" });
  const state = await job.getState();
  const progress = job.progress as { scanned?: number } | number | undefined;
  const processed = typeof progress === "object" ? (progress?.scanned ?? 0) : 0;
  return NextResponse.json({ state, processed });
}

/**
 * POST: rescore every live case in the project. One recompute per project
 * at a time (409 while one is queued or running).
 */
export async function POST(_req: NextRequest, context: RouteContext) {
  const auth = await authorize(context);
  if ("error" in auth) return auth.error;
  const { session, projectId } = auth;
  try {
    const project = await baseDb.projects.findUnique({
      where: { id: projectId },
      select: { riskScoringEnabled: true },
    });
    if (!project?.riskScoringEnabled) {
      return NextResponse.json(
        { error: "Risk scoring is disabled for this project" },
        { status: 400 }
      );
    }
    const { queue, job } = await findRecomputeJob(projectId);
    if (!queue) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 }
      );
    }
    if (job) {
      const state = await job.getState();
      if (state === "completed" || state === "failed") {
        // A finished job keeps its id until retention removes it; make room.
        await job.remove();
      } else {
        return NextResponse.json(
          { error: "A recompute is already running", jobId: job.id },
          { status: 409 }
        );
      }
    }
    const jobId = await enqueueRiskProjectRecompute({
      projectId,
      requestedById: session.user.id,
      tenantId: getCurrentTenantId(),
    });
    if (!jobId) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 }
      );
    }
    return NextResponse.json({ jobId });
  } catch (error) {
    console.error("[risk-score] recompute request failed:", error);
    return NextResponse.json(
      { error: "Failed to start the analysis" },
      { status: 500 }
    );
  }
}
