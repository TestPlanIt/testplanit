/**
 * Automation Candidates report — per-snapshot endpoint.
 *
 *   DELETE /api/reports/automation-candidates/[snapshotId]
 *
 * Soft-deletes a single snapshot (flips `isDeleted: true`). Soft-delete is
 * required because snapshots are an immutable history record — a deleted
 * row should never reappear under the same id if someone regenerates.
 *
 * Permission: project-side Reporting.canDelete (or project creator, project
 * admin, or system admin). The ZenStack policy on LlmReportSnapshot has
 * `@@allow('update', ...canAddEdit...)`, so we cannot simply route through
 * `enhanced.update({isDeleted: true})` — that would let canAddEdit users
 * delete, which is exactly what the Reports Delete permission is meant to
 * gate against. We check canDelete explicitly, then soft-delete with raw
 * baseDb to bypass the update-policy boundary on this one operation.
 *
 * (Read + list use the auto-generated ZenStack tanstack-query hooks
 * client-side — no custom GET route. The read policy on the snapshot model
 * already enforces project membership + isDeleted hiding.)
 */

import { ApplicationArea } from "~/zenstack/models";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import {
  areaPermissionsFrom,
  resolveEffectiveProjectAccess,
} from "~/lib/services/areaPermission";
import { authOptions } from "~/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withAuditContext(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ snapshotId: string }> }
  ) => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    updateAuditContext({ userId: session.user.id });

    const { snapshotId: snapshotIdParam } = await params;
    const snapshotId = Number.parseInt(snapshotIdParam, 10);
    if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
      return NextResponse.json(
        { error: "Invalid snapshot id" },
        { status: 400 }
      );
    }

    const snapshot = await baseDb.llmReportSnapshot.findFirst({
      where: { id: snapshotId, isDeleted: false },
      select: { id: true, projectId: true },
    });
    if (!snapshot) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const allowed = await userCanDeleteReportingFor(
      session.user.id,
      snapshot.projectId
    );
    if (!allowed) {
      return NextResponse.json(
        {
          error:
            "You don't have permission to delete reports for this project.",
        },
        { status: 403 }
      );
    }

    await baseDb.llmReportSnapshot.update({
      where: { id: snapshotId },
      data: { isDeleted: true, updatedAt: new Date() },
    });

    return NextResponse.json({ snapshotId, deleted: true });
  }
);

/**
 * Mirrors the Reporting.canDelete branch of the snapshot's ZenStack policy.
 * Returns true if the user is a system admin, a project admin (creator,
 * assigned PROJECTADMIN, or an effective role with Settings canAddEdit), or
 * has an effective role whose Reporting RolePermission has canDelete — the
 * ladder in lib/services/areaPermission.ts, so this route and the policy
 * cannot drift.
 */
async function userCanDeleteReportingFor(
  userId: string,
  projectId: number
): Promise<boolean> {
  const project = await baseDb.projects.findFirst({
    where: { id: projectId, isDeleted: false },
    select: { id: true },
  });
  if (!project) return false;

  const resolution = await resolveEffectiveProjectAccess(userId, projectId);
  return areaPermissionsFrom(resolution, ApplicationArea.Reporting).canDelete;
}
