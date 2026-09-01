import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { userHasAreaPermission } from "~/lib/services/areaPermission";
import { authOptions } from "~/server/auth";
import { ApplicationArea } from "~/zenstack/models";

/**
 * DELETE /api/projects/[projectId]/requirements/snapshots/[snapshotId]
 *
 * Soft-deletes a traceability snapshot: the header is flagged
 * `isDeleted` (stamped `deletedAt`) and leaves every picker, report, and
 * share; its entries stay for the audit trail. A route rather than the
 * model hook for two reasons: deletion is a Reporting `canDelete` act
 * (the hook's update path is gated on add/edit), and the model's
 * `@@deny('read', isDeleted)` makes the just-updated row unreadable, so
 * the ORM-level update reports a 422 even though it succeeded.
 *
 * Gate order, fixed: 401 -> 400 (ids) -> 403 (viewer's project scope
 * excludes the project) -> 403 (no Reporting delete on the project) ->
 * 404 (no live snapshot of THIS project with that id) -> 200. Idempotent
 * only in the sense that a second call 404s — the record is gone from the
 * caller's point of view.
 */
export const DELETE = withAuditContext(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ projectId: string; snapshotId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { projectId: projectIdParam, snapshotId: snapshotIdParam } =
        await params;
      const projectId = Number(projectIdParam);
      const snapshotId = Number(snapshotIdParam);
      if (
        !Number.isInteger(projectId) ||
        projectId <= 0 ||
        !Number.isInteger(snapshotId) ||
        snapshotId <= 0
      ) {
        return NextResponse.json(
          { error: "Invalid project or snapshot ID" },
          { status: 400 }
        );
      }

      const scope = await resolveViewerProjectScope(session.user.id);
      if (scope !== null && !scope.includes(projectId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const canDelete = await userHasAreaPermission(
        session.user.id,
        projectId,
        ApplicationArea.Reporting,
        "canDelete"
      );
      if (!canDelete) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const snapshot = await baseDb.requirementTraceabilitySnapshot.findFirst({
        where: { id: snapshotId, projectId, isDeleted: false },
        select: { id: true },
      });
      if (!snapshot) {
        return NextResponse.json(
          { error: "Snapshot not found" },
          { status: 404 }
        );
      }

      await baseDb.requirementTraceabilitySnapshot.update({
        where: { id: snapshot.id },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      return NextResponse.json({ id: snapshot.id });
    } catch (error) {
      console.error("Requirement traceability snapshot delete error:", error);
      return NextResponse.json(
        { error: "Failed to delete requirement traceability snapshot" },
        { status: 500 }
      );
    }
  }
);
