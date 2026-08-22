import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEnhancedDb } from "~/lib/auth/utils";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { assertValidReparent } from "~/lib/services/requirementHierarchy";
import { authOptions } from "~/server/auth";

// `parentId: null` is a first-class value here (moving a node to the root
// level), not an error — the schema accepts an explicit null distinctly
// from a missing field.
const requestSchema = z.object({
  parentId: z.number().int().nullable(),
});

/**
 * POST /api/projects/[projectId]/requirements/[issueId]/reparent
 *
 * The one write path for HIER-03's drag-and-drop reparent gesture (and any
 * other future reparent UI). `assertValidReparent` — Node-only, imports
 * `baseDb` — cannot run client-side, so this route is the server half every
 * reparent UI must call.
 *
 * Gate order, fixed (mirrors 22-03's recorded decision so a malformed
 * payload or a missing row never discloses project-admin status to an
 * unauthorized caller): 401 -> 400 (bad ids) -> 400 (bad body) -> 403
 * (authorizeProjectAdminForProject) -> 404 (child is not a live requirement
 * in this project) -> 400 (new parent is not a live requirement in this
 * project) -> assertValidReparent (400 on throw) -> write -> 200.
 *
 * `Issue`'s ZenStack policy carries no project-membership condition at all
 * (see schema.zmodel), so `authorizeProjectAdminForProject` is the ONLY
 * project boundary on this route — it must run on every call, and it must
 * run before the 404 row lookup so a non-admin can never probe whether a
 * given issue id exists in a project they cannot administer.
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

      const { projectId: projectIdParam, issueId: issueIdParam } = await params;
      const projectId = parseInt(projectIdParam);
      const issueId = parseInt(issueIdParam);
      if (isNaN(projectId) || isNaN(issueId)) {
        return NextResponse.json(
          { error: "Invalid project or issue ID" },
          { status: 400 }
        );
      }

      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400 }
        );
      }
      const parsedBody = requestSchema.safeParse(rawBody);
      if (!parsedBody.success) {
        return NextResponse.json(
          { error: "Invalid request body" },
          { status: 400 }
        );
      }
      const { parentId } = parsedBody.data;

      // Issue's model policy has no project scoping at all — this is the
      // only project boundary on this route.
      const auth = await authorizeProjectAdminForProject(session, projectId);
      if (!auth.ok) {
        return NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        );
      }

      // Scoped with REQUIREMENT_SCOPE_WHERE so this route can never be
      // pointed at a defect row via a crafted issueId.
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

      // MUST run before any write. assertSameProject closes cross-project
      // reparent; assertNoCycle closes cycles. The Postgres
      // tpl_issue_hierarchy_cycle_guard trigger remains the authoritative
      // backstop underneath, but it raises a transaction-aborting Postgres
      // error, not a message a user can act on — this is what produces the
      // friendly 400.
      //
      // Ordered ahead of the parent-role check below so each refusal keeps the
      // most specific message it can: a cross-project parent is named as such,
      // rather than being absorbed into the broader "not a live requirement".
      try {
        await assertValidReparent(baseDb, issueId, parentId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid reparent";
        return NextResponse.json({ error: message }, { status: 400 });
      }

      // The new parent is scoped exactly as strictly as the child. Without
      // this, `assertValidReparent` above is the only thing the parent id
      // passes through, and it checks project membership and cycles only —
      // so a crafted `parentId` naming a defect (or a soft-deleted
      // requirement) is structurally valid and gets written. The result is a
      // requirement that vanishes from the tree: it is not a root, and
      // `buildTree` only descends through requirement rows, so nothing ever
      // draws it. The project predicate is kept here as well: this check must
      // stand on its own if the service's own project assertion ever moves.
      // Refused as a 400 rather than a 404 because the offending value came
      // from the request body, matching how the route treats every other
      // unusable body value.
      if (parentId !== null) {
        const parent = await baseDb.issue.findFirst({
          where: {
            id: parentId,
            projectId,
            isDeleted: false,
            ...REQUIREMENT_SCOPE_WHERE,
          },
          select: { id: true },
        });
        if (!parent) {
          return NextResponse.json(
            {
              error:
                "New parent must be a live requirement in the same project",
            },
            { status: 400 }
          );
        }
      }

      // Write through the enhanced client so the schema's field-level
      // @deny on parentId gives a second, independent enforcement layer: a
      // synced, non-detached requirement's reparent is refused here even
      // though assertValidReparent already said the target was
      // structurally fine. Surface that rejection as a 403, not a 500.
      const db = await getEnhancedDb(session);
      try {
        await db.issue.update({
          where: { id: issueId },
          data: { parentId },
        });
      } catch {
        return NextResponse.json(
          {
            error: "You do not have permission to reparent this requirement",
          },
          { status: 403 }
        );
      }

      return NextResponse.json({ id: issueId, parentId });
    } catch (error) {
      console.error("Error reparenting requirement:", error);
      return NextResponse.json(
        { error: "Failed to reparent requirement" },
        { status: 500 }
      );
    }
  }
);
