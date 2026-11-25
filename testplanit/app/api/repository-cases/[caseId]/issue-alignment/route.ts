import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { isAccessPolicyError, isNotFoundError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";
import { z } from "zod/v4";
import { withRequestRouting } from "~/lib/db/requestRouting";

const alignmentBodySchema = z.object({
  issueId: z.number().int().positive(),
});

/**
 * POST /api/repository-cases/[caseId]/issue-alignment
 *
 * Record that a test case is up to date with a linked issue's text as it
 * reads now. The stamp is taken on the server because it is compared with
 * `Issue.contentUpdatedAt`, which the database stamps: a browser's clock on
 * either side of the two could hide a later change or keep the notice
 * showing.
 *
 * The `RepositoryCaseIssue` policy on the enhanced client is the whole
 * authorization, the same one that gates linking and unlinking.
 */
async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { caseId: caseIdParam } = await params;
    const caseId = Number(caseIdParam);
    if (!Number.isInteger(caseId)) {
      return NextResponse.json({ error: "Invalid case ID" }, { status: 400 });
    }

    const parsed = alignmentBodySchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }
    const { issueId } = parsed.data;

    try {
      const db = await getEnhancedDb(session);
      const updated = await db.repositoryCaseIssue.update({
        where: { caseId_issueId: { caseId, issueId } },
        data: { alignedAt: new Date() },
      });
      return NextResponse.json(
        { alignedAt: updated.alignedAt },
        { status: 200 }
      );
    } catch (updateError) {
      if (isNotFoundError(updateError)) {
        return NextResponse.json({ error: "Link not found" }, { status: 404 });
      }
      if (isAccessPolicyError(updateError)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      throw updateError;
    }
  } catch (error) {
    console.error("Issue alignment error:", error);
    return NextResponse.json(
      { error: "Failed to mark the test case as up to date" },
      { status: 500 }
    );
  }
}

export const POST = withRequestRouting(handlePOST);
