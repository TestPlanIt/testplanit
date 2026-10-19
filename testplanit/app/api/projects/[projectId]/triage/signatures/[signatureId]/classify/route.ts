import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { LlmManager } from "~/lib/llm/services/llm-manager.service";
import {
  isProjectAdminFor,
  userHasAreaPermission,
} from "~/lib/services/areaPermission";
import { enqueueSignatureClassification } from "~/lib/services/triage/enqueue";
import { getFailureTriageQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

/**
 * POST /api/projects/[projectId]/triage/signatures/[signatureId]/classify
 * Asks the project's AI model to (re)classify one signature. Same gate as
 * editing the signature: project admin or TestRuns add/edit.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; signatureId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolved = await params;
  const projectId = Number(resolved.projectId);
  const signatureId = Number(resolved.signatureId);
  if (!Number.isInteger(projectId) || !Number.isInteger(signatureId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const db = await getEnhancedDb(session);
    const signature = await db.failureSignature.findFirst({
      where: { id: signatureId, projectId },
      select: { id: true, project: { select: { failureTriageEnabled: true } } },
    });
    if (!signature) {
      return NextResponse.json(
        { error: "Signature not found" },
        { status: 404 }
      );
    }
    const allowed =
      (await isProjectAdminFor(session.user.id, projectId)) ||
      (await userHasAreaPermission(
        session.user.id,
        projectId,
        "TestRuns",
        "canAddEdit"
      ));
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!signature.project.failureTriageEnabled) {
      return NextResponse.json(
        { error: "Failure triage is disabled for this project" },
        { status: 400 }
      );
    }
    const provider = await LlmManager.getInstance(baseDb).resolveIntegration(
      LLM_FEATURES.FAILURE_TRIAGE,
      projectId
    );
    if (!provider) {
      return NextResponse.json(
        { error: "No AI model is configured for failure triage" },
        { status: 409 }
      );
    }
    if (!getFailureTriageQueue()) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 }
      );
    }
    await enqueueSignatureClassification({
      projectId,
      signatureIds: [signatureId],
      userId: session.user.id,
      tenantId: getCurrentTenantId(),
    });
    return NextResponse.json({ queued: true });
  } catch (error) {
    console.error("[failure-triage] classify request failed:", error);
    return NextResponse.json(
      { error: "Failed to request classification" },
      { status: 500 }
    );
  }
}
