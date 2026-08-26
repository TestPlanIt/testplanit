import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { isAccessPolicyError, isNotFoundError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";
import { z } from "zod/v4";

const dismissalBodySchema = z.object({
  issueId: z.number().int().positive(),
});

/**
 * POST /api/repository-cases/[caseId]/suspect-dismissal
 *
 * WR-02 (27.1-05): this route exists ONLY to move the suspect-dismissal
 * clock from the browser to the server -- `contentUpdatedAt` is stamped by
 * the Postgres trigger's `now()` and `isLinkageSuspect` compares the two with
 * a strict `>`, so a client-clock timestamp on either side of the skew
 * either leaves a dismissed badge showing or silently masks a genuine
 * content edit. `new Date()` below evaluates in this Node process, the same
 * clock family as the trigger, closing both directions.
 *
 * Authorization is unchanged from the `/api/model` tier this route replaces:
 * the `RepositoryCaseIssue` policy on the enhanced client (D-07's own
 * comment on the schema field -- the same TestCaseRepository canAddEdit
 * ladder that gates link/unlink) is the entire decision. This route
 * deliberately performs no scope pre-check and reads nothing else -- the
 * request body carries no field but `issueId`, so a client-supplied
 * timestamp has nowhere to go.
 *
 * Gate order: 401 (no session) -> 400 (non-integer caseId) -> 400 (invalid
 * body) -> 200/404/403/500.
 */
export async function POST(
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const parsed = dismissalBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { issueId } = parsed.data;

    try {
      const db = await getEnhancedDb(session);
      const updated = await db.repositoryCaseIssue.update({
        where: { caseId_issueId: { caseId, issueId } },
        data: { suspectDismissedAt: new Date() },
      });
      return NextResponse.json(
        { dismissedAt: updated.suspectDismissedAt },
        { status: 200 }
      );
    } catch (updateError) {
      if (isNotFoundError(updateError)) {
        return NextResponse.json(
          { error: "Reference not found" },
          { status: 404 }
        );
      }
      if (isAccessPolicyError(updateError)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      throw updateError;
    }
  } catch (error) {
    console.error("Suspect dismissal error:", error);
    return NextResponse.json(
      { error: "Failed to dismiss suspect flag" },
      { status: 500 }
    );
  }
}
