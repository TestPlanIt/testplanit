import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { getRequirementChildren } from "~/lib/services/requirementTree";
import { authOptions } from "~/server/auth";

/**
 * GET /api/projects/[projectId]/requirements/tree/[issueId]/children
 *
 * Same read gate as `tree/route.ts` -- any project member may expand a
 * node. `[issueId]` names the parent whose direct requirement children are
 * being loaded on demand (D-02).
 *
 * NO IDENTITY PRE-CHECK on `issueId`, deliberately (this plan's own
 * objective states the reasoning, repeated here since it is the argument a
 * future reader needs before adding one): `getRequirementChildren`'s own
 * query (`requirementTree.ts`) is already project- AND role-scoped, so an
 * unknown id, a foreign-project id, or a live-but-non-requirement id all
 * produce the exact SAME empty array a caller cannot distinguish from "this
 * node genuinely has no children" -- emptiness discloses nothing about
 * which of those cases occurred. Adding a `findFirst` pre-check here would
 * buy a nicer 404 at the cost of a brand-new ORM `Issue` read that the
 * role-scope containment gate would then have to carry a reviewed allowlist
 * entry for, on a route that reads nothing it does not already scope.
 * Someone will eventually want that nicer 404; this comment is the argument
 * they need to weigh against the cost above before adding it.
 *
 * Gate order, fixed: 401 (no session) -> 400 (non-numeric project or issue
 * id) -> 403 (viewer's project scope excludes the requested project) ->
 * 200/500.
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
    const projectId = Number(projectIdParam);
    const parentId = Number(issueIdParam);
    if (!Number.isInteger(projectId) || !Number.isInteger(parentId)) {
      return NextResponse.json(
        { error: "Invalid project or issue ID" },
        { status: 400 }
      );
    }

    const scope = await resolveViewerProjectScope(session.user.id);
    if (scope !== null && !scope.includes(projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await getRequirementChildren({ projectId, parentId });

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("Requirement children error:", error);
    return NextResponse.json(
      { error: "Failed to fetch requirement children" },
      { status: 500 }
    );
  }
}
