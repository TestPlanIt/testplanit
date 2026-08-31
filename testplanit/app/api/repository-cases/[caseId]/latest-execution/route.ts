import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { getCaseLatestExecutedAt } from "~/lib/services/latestCaseResults";
import { authOptions } from "~/server/auth";

export type CaseLatestExecutionResponse = {
  caseId: number;
  lastExecutedAt: string | null;
};

/**
 * GET /api/repository-cases/[caseId]/latest-execution
 *
 * The one value the case-side suspect computation is missing:
 * `components/requirements/LinkedRequirementsPanel.tsx` lists requirements
 * for ONE case, so `executed_at` is invariant across every row -- a single
 * value, not a map. The requirement-side panel already gets its
 * per-case timestamps free from the already-mounted
 * `useRequirementCoveringCases`; this route is the case side's only
 * equivalent source.
 *
 * Read-only, so it is gated with the viewer-scope resolver used by every
 * sibling read route rather than an admin-only project gate -- an
 * admin-only gate on a read would hide the badge from every regular
 * member.
 *
 * Gate order, fixed: 401 (no session) -> 400 (non-integer case id) ->
 * 404 (case does not exist, is soft-deleted, OR the viewer's project
 * scope excludes the case's OWN project) -> 200/500. The identity
 * pre-check runs BEFORE the scope check because the scope check needs the
 * case's real project -- there is no client-supplied project id to check
 * against instead; it is re-derived from the addressed row every time.
 * The scope failure answers 404, not 403: a distinguishable pair would
 * let a caller outside the project enumerate which case ids exist (the
 * sibling reference routes avoid the same oracle by gating on the
 * client-supplied projectId first, which this route does not have).
 */
export async function GET(
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

    // Identity pre-check first: this route addresses a case, not an issue,
    // so its where clause carries no requirement-role predicate at all.
    // The case row's own projectId is the only thing the 403 gate below
    // may trust.
    const existing = await baseDb.repositoryCases.findFirst({
      where: { id: caseId, isDeleted: false },
      select: { id: true, projectId: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    const scope = await resolveViewerProjectScope(session.user.id);
    if (scope !== null && !scope.includes(existing.projectId)) {
      return NextResponse.json({ error: "Case not found" }, { status: 404 });
    }

    const latestByCase = await getCaseLatestExecutedAt([caseId]);
    const lastExecutedAt = latestByCase.get(caseId) ?? null;

    const response: CaseLatestExecutionResponse = {
      caseId,
      lastExecutedAt: lastExecutedAt ? lastExecutedAt.toISOString() : null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Case latest-execution error:", error);
    return NextResponse.json(
      { error: "Failed to fetch case latest execution" },
      { status: 500 }
    );
  }
}
