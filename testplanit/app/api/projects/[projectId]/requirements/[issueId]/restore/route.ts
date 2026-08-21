import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { restoreRequirementSubtree } from "~/lib/services/requirementHierarchy";
import { authOptions } from "~/server/auth";

// This route takes no request body -- issueId is already the path param. An
// absent or empty body is tolerated; a non-empty body must still be a plain
// object with no unexpected keys, so a client sending the wrong shape gets
// an actionable 400 instead of the body being silently ignored.
const emptyBodySchema = z.object({}).strict();

/**
 * POST /api/projects/[projectId]/requirements/[issueId]/restore
 *
 * Symmetric restore entry point for HIER-04, mirroring delete-subtree's
 * shape exactly (same auth, inverse service call). A thin authorized
 * wrapper around `restoreRequirementSubtree`
 * (lib/services/requirementHierarchy.ts) -- no hand-rolled CTE, transaction,
 * or bulk UPDATE here.
 *
 * The 404 pre-check looks for a SOFT-DELETED requirement (`isDeleted:
 * true`), the mirror of delete-subtree's live-row check -- a restore
 * addressed at a live row is a client bug, not a silent no-op.
 *
 * Gate order, fixed: 401 -> 400 (bad ids) -> 400 (bad body) -> 403
 * (authorizeProjectAdminForProject) -> 404 (not a soft-deleted requirement
 * in this project) -> operate.
 */
export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string; issueId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { projectId: projectIdParam, issueId: issueIdParam } =
        await params;
      const projectId = parseInt(projectIdParam);
      const issueId = parseInt(issueIdParam);
      if (isNaN(projectId) || isNaN(issueId)) {
        return NextResponse.json(
          { error: "Invalid project or issue ID" },
          { status: 400 }
        );
      }

      const rawBody = await request.text();
      if (rawBody.trim().length > 0) {
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawBody);
        } catch {
          return NextResponse.json(
            { error: "Invalid request body" },
            { status: 400 }
          );
        }
        const parsedBody = emptyBodySchema.safeParse(parsedJson);
        if (!parsedBody.success) {
          return NextResponse.json(
            { error: "Invalid request body" },
            { status: 400 }
          );
        }
      }

      // Issue's model policy has no project scoping at all -- this is the
      // only project boundary on this route.
      const auth = await authorizeProjectAdminForProject(session, projectId);
      if (!auth.ok) {
        return NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        );
      }

      // Scoped with REQUIREMENT_SCOPE_WHERE so this route can never be
      // pointed at a defect row via a crafted issueId. isDeleted: true is
      // the mirror of delete-subtree's isDeleted: false check.
      const existing = await baseDb.issue.findFirst({
        where: {
          id: issueId,
          projectId,
          isDeleted: true,
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

      const result = await restoreRequirementSubtree(issueId, projectId);

      return NextResponse.json({ restoredIds: result.restoredIds });
    } catch (error) {
      console.error("Error restoring requirement subtree:", error);
      return NextResponse.json(
        { error: "Failed to restore requirement subtree" },
        { status: 500 }
      );
    }
  }
);
