import { getServerSession } from "next-auth";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEnhancedDb } from "~/lib/auth/utils";
import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

const bodySchema = z.object({
  testRunId: z.number().int().positive().optional(),
  acceptedCaseIds: z.array(z.number().int().positive()).max(10000),
  addedCaseIds: z.array(z.number().int().positive()).max(10000).optional(),
});

/**
 * PATCH /api/projects/[projectId]/impact/analyses/[analysisId]/cases
 * Records the reviewer's decision: which suggested cases were accepted,
 * which cases were added by hand, and (optionally) the run they went into.
 * This is the raw material for the accuracy readout.
 */
export const PATCH = withAuditContext(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ projectId: string; analysisId: string }> }
  ) => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    updateAuditContext({ userId: session.user.id });

    const resolved = await params;
    const projectId = Number(resolved.projectId);
    const analysisId = Number(resolved.analysisId);
    if (!Number.isInteger(projectId) || !Number.isInteger(analysisId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { testRunId, acceptedCaseIds } = parsed.data;
    const accepted = new Set(acceptedCaseIds);
    const added = (parsed.data.addedCaseIds ?? []).filter(
      (id) => !accepted.has(id)
    );

    try {
      const db = await getEnhancedDb(session);
      const row = await db.impactAnalysis.findFirst({
        where: { id: analysisId, projectId, isDeleted: false },
        select: { id: true },
      });
      if (!row) {
        return NextResponse.json(
          { error: "Analysis not found" },
          { status: 404 }
        );
      }
      if (testRunId !== undefined) {
        const run = await db.testRuns.findFirst({
          where: { id: testRunId, projectId, isDeleted: false },
          select: { id: true },
        });
        if (!run) {
          return NextResponse.json({ error: "Run not found" }, { status: 404 });
        }
      }

      const reviewed = {
        reviewedAt: new Date(),
        reviewedById: session.user.id,
      };
      const acceptedResult = await db.impactAnalysisCase.updateMany({
        where: { analysisId, suggested: true, caseId: { in: acceptedCaseIds } },
        data: { accepted: true, ...reviewed },
      });
      const rejectedResult = await db.impactAnalysisCase.updateMany({
        where: {
          analysisId,
          suggested: true,
          caseId: { notIn: acceptedCaseIds },
        },
        data: { accepted: false, ...reviewed },
      });

      let addedCount = 0;
      for (const caseId of added) {
        await db.impactAnalysisCase.upsert({
          where: { analysisId_caseId: { analysisId, caseId } },
          create: {
            analysisId,
            caseId,
            score: 0,
            tier: "related",
            layers: [],
            reasons: [],
            coveredFiles: [],
            suggested: false,
            addedManually: true,
            accepted: true,
            ...reviewed,
          },
          update: { addedManually: true, accepted: true, ...reviewed },
        });
        addedCount++;
      }

      if (testRunId !== undefined) {
        await db.impactAnalysis.update({
          where: { id: analysisId },
          data: { testRunId },
        });
      }

      return NextResponse.json({
        accepted: acceptedResult.count,
        rejected: rejectedResult.count,
        added: addedCount,
        testRunId: testRunId ?? null,
      });
    } catch (error) {
      if (isAccessPolicyError(error)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      console.error("Impact analysis review error:", error);
      return NextResponse.json(
        { error: "Failed to record review" },
        { status: 500 }
      );
    }
  }
);
