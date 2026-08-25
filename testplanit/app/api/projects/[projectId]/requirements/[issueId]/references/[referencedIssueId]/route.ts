import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getEnhancedDb } from "~/lib/auth/utils";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { authOptions } from "~/server/auth";

/**
 * DELETE /api/projects/[projectId]/requirements/[issueId]/references/[referencedIssueId]
 *
 * LINK-03 (D-15): hard-delete a manual traceability reference — the
 * RequirementIssueReference join row only. The referenced Issue row is
 * NEVER touched here: it may be shared by other requirements, linked to
 * cases as a defect, or owned by a tracker.
 *
 * Shares Task 1's exact gate order so the two halves of the feature can
 * never disagree about who may edit references: 401 (no session) -> 400
 * (non-integer id anywhere in the path) -> 403 (resolveViewerProjectScope
 * excludes the requirement's project) -> 404 (requirement identity
 * pre-check) -> 200/500. No cross-project gate is needed on the referenced
 * issue for DELETE — removing a row discloses nothing the caller did not
 * already have.
 */
export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      projectId: string;
      issueId: string;
      referencedIssueId: string;
    }>;
  }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      projectId: projectIdParam,
      issueId: issueIdParam,
      referencedIssueId: referencedIssueIdParam,
    } = await params;
    const projectId = Number(projectIdParam);
    const issueId = Number(issueIdParam);
    const referencedIssueId = Number(referencedIssueIdParam);
    if (
      !Number.isInteger(projectId) ||
      !Number.isInteger(issueId) ||
      !Number.isInteger(referencedIssueId)
    ) {
      return NextResponse.json(
        { error: "Invalid project, requirement, or referenced issue ID" },
        { status: 400 }
      );
    }

    const scope = await resolveViewerProjectScope(session.user.id);
    if (scope !== null && !scope.includes(projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Same requirement identity pre-check as the POST route — bound to
    // projectId and spread with REQUIREMENT_SCOPE_WHERE, so a crafted
    // issueId can never aim this route at a defect row or another
    // project's requirement. Detaching a reference does not need to gate
    // on the requirement row's own tombstone state (the generic
    // app/api/issues/[issueId]/unlink/route.ts identity check carries no
    // such filter either) — only the join row's presence matters below.
    const existing = await baseDb.issue.findFirst({
      where: {
        id: issueId,
        projectId,
        ...REQUIREMENT_SCOPE_WHERE,
      },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Requirement not found" },
        { status: 404 }
      );
    }

    // The bulk-delete form, not the single-row form, so a not-found pair
    // is a no-op rather than a thrown error — the exact idiom
    // app/api/issues/[issueId]/unlink/route.ts uses for its own bare
    // join. D-15 is absolute: only the join row is removed, the
    // referenced Issue row is never touched.
    const enhancedDb = await getEnhancedDb(session);
    const result = await enhancedDb.requirementIssueReference.deleteMany({
      where: { requirementId: issueId, referencedIssueId },
    });

    return NextResponse.json({ deletedCount: result.count }, { status: 200 });
  } catch (error) {
    console.error("Requirement reference delete error:", error);
    return NextResponse.json(
      { error: "Failed to remove reference" },
      { status: 500 }
    );
  }
}
