import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEnhancedDb } from "~/lib/auth/utils";
import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { getImpactAnalysisQueue } from "~/lib/queues";
import {
  loadRepoConfigForUser,
  resolveImpactConfigId,
} from "~/lib/services/impact/repoAccess";
import { startImpactAnalysis } from "~/lib/services/impact/startAnalysis";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

const refSchema = z.string().trim().min(1).max(255).regex(/^\S+$/);

const createSchema = z.object({
  /** Which connected repository to compare in; optional when only one is. */
  configId: z.number().int().positive().optional(),
  base: refSchema,
  head: refSchema,
  notes: z.string().max(2000).optional(),
  force: z.boolean().optional(),
});

const listSelect = {
  id: true,
  baseSha: true,
  headSha: true,
  baseRef: true,
  headRef: true,
  status: true,
  error: true,
  notes: true,
  fileCount: true,
  additions: true,
  deletions: true,
  truncated: true,
  pinnedCaseCount: true,
  affectedCaseCount: true,
  testRunId: true,
  createdAt: true,
  completedAt: true,
  createdBy: { select: { id: true, name: true } },
  _count: { select: { cases: true } },
} as const;

function parseProjectId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * POST /api/projects/[projectId]/impact/analyses
 * Create an Impact analysis for base..head and enqueue the worker job.
 * Refs are resolved to full shas here so a completed analysis for the same
 * pair can be reused within `impactConfig.reuseHours` unless `force`.
 * Gate order: 401 -> 400 -> 404 (project) -> 409 (feature off) ->
 * 400 (several repos, no configId) -> 404 (config) -> 404 (ref) ->
 * 400 (same commit) -> 403 (policy) -> 503 (queue) -> 202.
 */
export const POST = withAuditContext(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
  ) => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    updateAuditContext({ userId: session.user.id });

    const projectId = parseProjectId((await params).projectId);
    if (projectId === null) {
      return NextResponse.json(
        { error: "Invalid project id" },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { base, head, notes, force } = parsed.data;
    const requestedConfigId = parsed.data.configId ?? null;

    try {
      const db = await getEnhancedDb(session);
      const project = await db.projects.findFirst({
        where: { id: projectId, isDeleted: false },
        select: { impactEnabled: true },
      });
      if (!project) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }
      if (!project.impactEnabled) {
        return NextResponse.json(
          {
            error: "Impact is not enabled for this project",
            code: "impact_disabled",
          },
          { status: 409 }
        );
      }
      const resolution = await resolveImpactConfigId(
        db,
        projectId,
        requestedConfigId
      );
      if ("error" in resolution && resolution.error === "ambiguous") {
        return NextResponse.json(
          {
            error:
              "Several repositories are connected for Impact; pass configId",
            code: "config_required",
          },
          { status: 400 }
        );
      }
      const configId = "configId" in resolution ? resolution.configId : null;
      const loaded = configId
        ? await loadRepoConfigForUser(session, configId, { purpose: "IMPACT" })
        : null;
      if (!configId || !loaded) {
        return NextResponse.json(
          {
            error: "Impact repository not configured",
            code: "no_impact_config",
          },
          { status: 404 }
        );
      }

      const aiAvailable = Boolean(
        await db.projectLlmIntegration.findFirst({
          where: {
            projectId,
            isActive: true,
            llmIntegration: { status: "ACTIVE", isDeleted: false },
          },
          select: { id: true },
        })
      );

      const started = await startImpactAnalysis(
        db,
        loaded,
        getImpactAnalysisQueue(),
        {
          projectId,
          base,
          head,
          createdById: session.user.id,
          notes,
          force,
          tenantId: getCurrentTenantId(),
        }
      );
      if (!started.ok) {
        const status =
          started.code === "ref_not_found"
            ? 404
            : started.code === "same_commit"
              ? 400
              : 503;
        return NextResponse.json({ error: started.message }, { status });
      }
      if (started.reused) {
        return NextResponse.json(
          {
            analysisId: started.analysisId,
            jobId: started.jobId,
            reused: true,
            aiAvailable,
          },
          { status: 200 }
        );
      }
      return NextResponse.json(
        {
          analysisId: started.analysisId,
          jobId: started.jobId,
          reused: false,
          aiAvailable,
        },
        { status: 202 }
      );
    } catch (error) {
      if (isAccessPolicyError(error)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      console.error("Impact analysis create error:", error);
      return NextResponse.json(
        { error: "Failed to create analysis" },
        { status: 500 }
      );
    }
  }
);

/**
 * GET /api/projects/[projectId]/impact/analyses?take=&cursor=&configId=
 * Newest analyses first, optionally for one connected repository. Policy on
 * the enhanced client scopes rows.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const projectId = parseProjectId((await params).projectId);
  if (projectId === null) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  const takeRaw = Number(req.nextUrl.searchParams.get("take") ?? "20");
  const take = Number.isInteger(takeRaw)
    ? Math.min(50, Math.max(1, takeRaw))
    : 20;
  const cursorRaw = req.nextUrl.searchParams.get("cursor");
  const cursor = cursorRaw ? Number(cursorRaw) : null;
  const configIdRaw = req.nextUrl.searchParams.get("configId");
  const configId = configIdRaw ? Number(configIdRaw) : null;
  if (configIdRaw && (!Number.isInteger(configId) || configId! <= 0)) {
    return NextResponse.json({ error: "Invalid config id" }, { status: 400 });
  }

  try {
    const db = await getEnhancedDb(session);
    const rows = await db.impactAnalysis.findMany({
      where: {
        projectId,
        isDeleted: false,
        ...(configId ? { configId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor && Number.isInteger(cursor)
        ? { cursor: { id: cursor }, skip: 1 }
        : {}),
      select: listSelect,
    });
    const hasMore = rows.length > take;
    const analyses = hasMore ? rows.slice(0, take) : rows;
    return NextResponse.json({
      analyses,
      nextCursor: hasMore ? (analyses[analyses.length - 1]?.id ?? null) : null,
    });
  } catch (error) {
    console.error("Impact analysis list error:", error);
    return NextResponse.json(
      { error: "Failed to list analyses" },
      { status: 500 }
    );
  }
}
