import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { getRequirementSubtreeCount } from "~/lib/services/requirementHierarchy";
import { authOptions } from "~/server/auth";

/**
 * GET /api/projects/[projectId]/requirements/[issueId]/descendant-count
 *
 * Feeds `DeleteRequirementModal`'s lazy-mode count display -- the sibling of
 * `delete-subtree/route.ts` this route's own gate is copied from verbatim
 * (401 -> 400 -> 403 -> 404 -> operate), swapping the terminal mutating call
 * for a count-only read. It carries the SAME project-admin tier as the
 * delete it stages a confirmation for, since a subtree count is exactly the
 * information a non-admin should not get to preview ahead of a delete they
 * cannot perform.
 *
 * `GET`, not `delete-subtree/route.ts`'s `POST` -- this route takes no
 * request body at all (there is no folder-style payload to carry; the
 * addressed requirement is already the path's own `issueId`), so there is
 * nothing for a POST body to hold. A side-effect-free read is the more
 * honest verb here.
 *
 * Gate order, fixed: 401 (no session) -> 400 (bad ids) -> 403
 * (`authorizeProjectAdminForProject`) -> 404 (not a live requirement in this
 * project, `REQUIREMENT_SCOPE_WHERE`-scoped) -> 200. 403 precedes the 404
 * identity check deliberately (T-28-10-03) -- a non-admin caller must never
 * be able to use this route's 404/200 split to learn whether a requirement
 * id exists in a project they cannot administer.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; issueId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam, issueId: issueIdParam } = await params;
    const projectId = parseInt(projectIdParam);
    const issueId = parseInt(issueIdParam);
    if (isNaN(projectId) || isNaN(issueId)) {
      return NextResponse.json(
        { error: "Invalid project or issue ID" },
        { status: 400 }
      );
    }

    const auth = await authorizeProjectAdminForProject(session, projectId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Scoped with REQUIREMENT_SCOPE_WHERE so this route can never be pointed
    // at a defect row via a crafted issueId -- same reasoning as
    // delete-subtree/route.ts's own identity pre-check, which this mirrors.
    const existing = await baseDb.issue.findFirst({
      where: {
        id: issueId,
        projectId,
        isDeleted: false,
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

    const count = await getRequirementSubtreeCount(issueId, projectId);

    return NextResponse.json({ count });
  } catch (error) {
    console.error("Error counting requirement subtree:", error);
    return NextResponse.json(
      { error: "Failed to count requirement subtree" },
      { status: 500 }
    );
  }
}
