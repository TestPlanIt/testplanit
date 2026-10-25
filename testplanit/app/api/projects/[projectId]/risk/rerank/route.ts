import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEnhancedDb } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { extractTextFromTipTap } from "~/lib/llm/services/tiptap-text";
import { LlmManager } from "~/lib/llm/services/llm-manager.service";
import { PromptResolver } from "~/lib/llm/services/prompt-resolver.service";
import { JOB_RISK_RERANK } from "~/lib/queueNames";
import { getRiskScoreQueue } from "~/lib/queues";
import { RERANK_MAX_CANDIDATES } from "~/lib/schemas/riskRerank";
import { authOptions } from "~/server/auth";

/**
 * POST /api/projects/[projectId]/risk/rerank
 *
 * Queues one LLM re-rank of the candidates the user is looking at and hands
 * back the job id to poll. Open to anyone who can read the project: this
 * composes a run, it does not change a setting, and it writes nothing.
 */
const bodySchema = z.object({
  caseIds: z.array(z.number().int()).min(1).max(RERANK_MAX_CANDIDATES),
  // The run's own words are context, not input to validate. The description
  // arrives as the editor holds it — a TipTap document, that document as a
  // JSON string, or plain text — so it is flattened below rather than
  // type-checked here, which would silently drop every rich-text run.
  runContext: z.object({
    name: z.string().max(500).catch(""),
    description: z.unknown().nullish(),
    tags: z.array(z.string().max(100)).max(50).optional().catch([]),
  }),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { projectId: raw } = await context.params;
  const projectId = Number(raw);
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Through the policy client: a project the caller cannot read is absent,
    // which is also what stops one project's ids reaching another's re-rank.
    const db = await getEnhancedDb(session);
    const project = await db.projects.findFirst({
      where: { id: projectId, isDeleted: false },
      select: { riskScoringEnabled: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!project.riskScoringEnabled) {
      return NextResponse.json(
        { error: "Risk scoring is disabled for this project" },
        { status: 400 }
      );
    }

    // Resolved exactly as the worker will resolve it — the prompt carries
    // its own model assignment, and a gate that ignored it would turn away
    // a project whose model is set there.
    const prompt = await new PromptResolver(baseDb as never).resolve(
      LLM_FEATURES.RISK_RERANK,
      projectId
    );
    const provider = await LlmManager.getInstance(baseDb).resolveIntegration(
      LLM_FEATURES.RISK_RERANK,
      projectId,
      prompt
    );
    if (!provider) {
      return NextResponse.json(
        { error: "No AI model is configured for risk re-ranking" },
        { status: 409 }
      );
    }

    const queue = getRiskScoreQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 }
      );
    }
    // No `priority`: in BullMQ a job with no explicit priority is served
    // BEFORE prioritized ones, so setting one here would put this — the only
    // job on the queue anybody is waiting for — behind every recompute.
    // Retention is the queue's own, which already keeps a completed job long
    // enough to be polled.
    const job = await queue.add(JOB_RISK_RERANK, {
      projectId,
      caseIds: parsed.data.caseIds,
      runContext: {
        name: parsed.data.runContext.name,
        description: extractTextFromTipTap(parsed.data.runContext.description),
        tags: parsed.data.runContext.tags,
      },
      userId: session.user.id,
      tenantId: getCurrentTenantId(),
    });
    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    console.error("[risk-rerank] submit failed:", error);
    return NextResponse.json(
      { error: "Failed to request a re-rank" },
      { status: 500 }
    );
  }
}
