import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEnhancedDb } from "~/lib/auth/utils";
import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { getImpactAnalysisQueue } from "~/lib/queues";
import {
  RefNotFoundError,
  resolveRefToSha,
} from "~/lib/services/impact/compareService";
import { impactConfig } from "~/lib/services/impact/config";
import { impactJobId } from "~/lib/services/impact/jobKeys";
import {
  findImpactConfigId,
  loadRepoConfigForUser,
} from "~/lib/services/impact/repoAccess";
import type { ImpactAnalysisJobData } from "~/lib/services/impact/types";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

const refSchema = z.string().trim().min(1).max(255).regex(/^\S+$/);

const createSchema = z.object({
  base: refSchema,
  head: refSchema,
  notes: z.string().max(2000).optional(),
  excludeCaseIds: z.array(z.number().int().positive()).max(5000).optional(),
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
 * Gate order: 401 -> 400 -> 404 (project/config) -> 409 (feature off) ->
 * 404 (ref) -> 400 (same commit) -> 403 (policy) -> 503 (queue) -> 202.
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
    const { base, head, notes, excludeCaseIds, force } = parsed.data;

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
      const configId = await findImpactConfigId(db, projectId);
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

      let baseSha: string;
      let headSha: string;
      try {
        [baseSha, headSha] = await Promise.all([
          resolveRefToSha(loaded.adapter, base),
          resolveRefToSha(loaded.adapter, head),
        ]);
      } catch (error) {
        if (error instanceof RefNotFoundError) {
          return NextResponse.json({ error: error.message }, { status: 404 });
        }
        throw error;
      }
      if (baseSha === headSha) {
        return NextResponse.json(
          { error: "Base and head resolve to the same commit" },
          { status: 400 }
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

      if (!force) {
        const reusable = await db.impactAnalysis.findFirst({
          where: {
            configId,
            baseSha,
            headSha,
            status: "COMPLETED",
            isDeleted: false,
            createdAt: {
              gte: new Date(Date.now() - impactConfig.reuseHours * 3600_000),
            },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, jobId: true },
        });
        if (reusable) {
          return NextResponse.json(
            {
              analysisId: reusable.id,
              jobId: reusable.jobId,
              reused: true,
              aiAvailable,
            },
            { status: 200 }
          );
        }
      }

      const created = await db.impactAnalysis.create({
        data: {
          projectId,
          configId,
          baseSha,
          headSha,
          baseRef: base === baseSha ? null : base,
          headRef: head === headSha ? null : head,
          notes: notes ?? null,
          createdById: session.user.id,
        },
        select: { id: true },
      });

      const queue = getImpactAnalysisQueue();
      if (!queue) {
        await db.impactAnalysis.update({
          where: { id: created.id },
          data: {
            status: "FAILED",
            error: "Background job queue is not available",
          },
        });
        return NextResponse.json(
          { error: "Background job queue is not available" },
          { status: 503 }
        );
      }

      const jobId = impactJobId(created.id);
      const jobData: ImpactAnalysisJobData = {
        analysisId: created.id,
        projectId,
        configId,
        baseSha,
        headSha,
        userId: session.user.id,
        notes,
        excludeCaseIds,
        tenantId: getCurrentTenantId(),
      };
      try {
        await queue.add("analyze", jobData, { jobId });
      } catch (error) {
        await db.impactAnalysis.update({
          where: { id: created.id },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : "Enqueue failed",
          },
        });
        return NextResponse.json(
          { error: "Failed to enqueue analysis" },
          { status: 503 }
        );
      }
      await db.impactAnalysis.update({
        where: { id: created.id },
        data: { jobId },
      });

      return NextResponse.json(
        { analysisId: created.id, jobId, reused: false, aiAvailable },
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
 * GET /api/projects/[projectId]/impact/analyses?take=&cursor=
 * Newest analyses first. Policy on the enhanced client scopes rows.
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

  try {
    const db = await getEnhancedDb(session);
    const rows = await db.impactAnalysis.findMany({
      where: { projectId, isDeleted: false },
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
