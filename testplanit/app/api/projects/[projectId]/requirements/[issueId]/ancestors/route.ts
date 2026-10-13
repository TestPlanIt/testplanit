import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { getRequirementAncestorChain } from "~/lib/services/requirementTree";
import { authOptions } from "~/server/auth";

/**
 * GET /api/projects/[projectId]/requirements/[issueId]/ancestors
 *
 * The breadcrumb's parent chain, outermost first. Exists so the two surfaces
 * that show a requirement WITHOUT the tree -- the full-width panel and the
 * standalone route -- can render a path without the client holding the whole
 * project: the hook this feeds used to fetch every requirement in the
 * project and walk `parentId` in the browser, which on an 11,000-requirement
 * project meant downloading all of them to render two or three names.
 *
 * VIEWER-level authorization, deliberately NOT the project-admin gate its
 * `descendant-count` sibling carries. That route previews how much a delete
 * would take with it, which is information a non-admin should not get ahead
 * of an action they cannot perform. A breadcrumb is the opposite: it is
 * ordinary context for a requirement the viewer is already looking at, and
 * gating it behind admin would blank the path for everyone else.
 *
 * Gate order: 401 (no session) -> 400 (bad ids) -> 403 (project outside the
 * viewer's scope) -> 404 (not a live requirement in this project) -> 200.
 * The 403 precedes the identity check so a caller cannot use the 404/200
 * split to probe which ids exist in a project they cannot see.
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

    // `null` means unrestricted (ADMIN); otherwise the project must be one
    // the viewer can reach.
    const scope = await resolveViewerProjectScope(session.user.id);
    if (scope !== null && !scope.includes(projectId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Scoped with REQUIREMENT_SCOPE_WHERE so this route can never be pointed
    // at a defect row via a crafted issueId -- the same identity pre-check
    // its sibling routes in this directory perform.
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

    const ancestors = await getRequirementAncestorChain(projectId, issueId);

    return NextResponse.json({ ancestors });
  } catch (error) {
    console.error("Error resolving requirement ancestors:", error);
    return NextResponse.json(
      { error: "Failed to resolve requirement ancestors" },
      { status: 500 }
    );
  }
}
