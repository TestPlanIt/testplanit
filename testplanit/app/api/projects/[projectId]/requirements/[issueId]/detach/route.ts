import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEnhancedDb } from "~/lib/auth/utils";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { authOptions } from "~/server/auth";

// This route takes no request body. An absent or empty body is tolerated;
// a non-empty body must still be a plain object with no unexpected keys,
// so a client sending the wrong shape gets an actionable 400 instead of
// the body being silently ignored.
const emptyBodySchema = z.object({}).strict();

/**
 * POST /api/projects/[projectId]/requirements/[issueId]/detach
 *
 * PROV-02: converts a synced, locked requirement to local ownership.
 * Mirrors app/api/milestones/[milestoneId]/unlink/route.ts's shape, with
 * the milestone route's IntegrationProject mapping-resolution step dropped
 * -- Issue carries integrationId directly, with no intermediate mapping
 * table to go orphaned the way a milestone's sync mapping can.
 *
 * Every value written is resolved server-side from the addressed row --
 * nothing about the integration comes from the request body (this route
 * reads no functional fields from the body at all). `integrationId` is
 * NEVER written here -- the Jira
 * reference badge depends on it surviving detach. Only
 * `requirementDetachedAt` is set; it is deliberately NOT one of the five
 * `LOCKED_ISSUE_FIELDS`, so a plain enhanced-client write satisfies the
 * schema policy even on a currently-locked row -- detach is precisely the
 * operation that lifts the lock on the other five fields going forward.
 *
 * Idempotent, mirroring `convertMilestoneToLocal`'s documented convention:
 * detaching an already-detached requirement succeeds as a no-op rather than
 * erroring.
 *
 * Gate order, fixed: 401 -> 400 (bad ids) -> 400 (bad body) -> 403
 * (authorizeProjectAdminForProject) -> 404 (not a live requirement in this
 * project) -> 400 (no integrationId to detach from) -> operate.
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
      // pointed at a defect row via a crafted issueId. Every value written
      // below is resolved from this row, never from client input.
      const existing = await baseDb.issue.findFirst({
        where: {
          id: issueId,
          projectId,
          isDeleted: false,
          ...REQUIREMENT_SCOPE_WHERE,
        },
        select: {
          id: true,
          integrationId: true,
          requirementDetachedAt: true,
        },
      });
      if (!existing) {
        return NextResponse.json(
          { error: "Requirement not found" },
          { status: 404 }
        );
      }

      if (existing.integrationId == null) {
        return NextResponse.json(
          { error: "This requirement is not synced with an issue tracker." },
          { status: 400 }
        );
      }

      if (existing.requirementDetachedAt != null) {
        // Idempotent no-op -- already detached.
        return NextResponse.json({
          success: true,
          requirementDetachedAt: existing.requirementDetachedAt.toISOString(),
        });
      }

      // requirementDetachedAt is not in LOCKED_ISSUE_FIELDS, so this write
      // satisfies the schema's field-level @deny even on a currently-locked
      // row. integrationId is never touched.
      const db = await getEnhancedDb(session);
      const updated = await db.issue.update({
        where: { id: issueId },
        data: { requirementDetachedAt: new Date() },
        select: { requirementDetachedAt: true },
      });

      return NextResponse.json({
        success: true,
        requirementDetachedAt: updated.requirementDetachedAt!.toISOString(),
      });
    } catch (error) {
      console.error("Error detaching requirement:", error);
      return NextResponse.json(
        { error: "Failed to detach requirement" },
        { status: 500 }
      );
    }
  }
);
