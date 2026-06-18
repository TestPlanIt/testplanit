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
 * prisma to bypass the update-policy boundary on this one operation.
 *
 * (Read + list use the auto-generated ZenStack tanstack-query hooks
 * client-side — no custom GET route. The read policy on the snapshot model
 * already enforces project membership + isDeleted hiding.)
 */

import { ApplicationArea, ProjectAccessType } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { updateAuditContext } from "~/lib/auditContext";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { authOptions } from "~/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withAuditContext(async (
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
    return NextResponse.json({ error: "Invalid snapshot id" }, { status: 400 });
  }

  const snapshot = await prisma.llmReportSnapshot.findFirst({
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
        error: "You don't have permission to delete reports for this project.",
      },
      { status: 403 }
    );
  }

  await prisma.llmReportSnapshot.update({
    where: { id: snapshotId },
    data: { isDeleted: true, updatedAt: new Date() },
  });

  return NextResponse.json({ snapshotId, deleted: true });
});

/**
 * Mirrors the Reporting.canDelete branch of the snapshot's ZenStack policy.
 * Returns true if the user is a system admin, the project's creator, a
 * project admin assigned to the project, or has a role (via user or group
 * permission) whose Reporting RolePermission has canDelete.
 *
 * Implemented as one Prisma query rather than walking the auth context so
 * the route doesn't ALSO have to keep up with policy edits in two places —
 * the policy stays the source of truth and this helper expresses the same
 * predicate.
 */
async function userCanDeleteReportingFor(
  userId: string,
  projectId: number
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { access: true },
  });
  if (!user) return false;
  if (user.access === "ADMIN") return true;

  const project = await prisma.projects.findFirst({
    where: { id: projectId, isDeleted: false },
    select: {
      createdBy: true,
      assignedUsers: {
        where: { userId },
        select: { userId: true },
      },
      userPermissions: {
        where: {
          userId,
          accessType: { not: ProjectAccessType.NO_ACCESS },
        },
        select: {
          accessType: true,
          role: {
            select: {
              name: true,
              rolePermissions: {
                where: { area: ApplicationArea.Reporting },
                select: { canDelete: true },
              },
            },
          },
        },
      },
      groupPermissions: {
        where: {
          group: {
            assignedUsers: { some: { userId } },
          },
          accessType: { not: ProjectAccessType.NO_ACCESS },
        },
        select: {
          accessType: true,
          role: {
            select: {
              rolePermissions: {
                where: { area: ApplicationArea.Reporting },
                select: { canDelete: true },
              },
            },
          },
        },
      },
    },
  });
  if (!project) return false;

  if (project.createdBy === userId) return true;

  if (user.access === "PROJECTADMIN" && project.assignedUsers.length > 0) {
    return true;
  }

  for (const up of project.userPermissions) {
    if (up.accessType === "SPECIFIC_ROLE") {
      if (up.role?.name === "Project Admin") return true;
      if (up.role?.rolePermissions.some((p) => p.canDelete)) return true;
    }
  }

  // GLOBAL_ROLE group permission falls back to the auth user's own role.
  // SPECIFIC_ROLE group permission carries its own role.
  if (project.groupPermissions.length > 0) {
    for (const gp of project.groupPermissions) {
      if (
        gp.accessType === "SPECIFIC_ROLE" &&
        gp.role?.rolePermissions.some((p) => p.canDelete)
      ) {
        return true;
      }
      if (gp.accessType === "GLOBAL_ROLE") {
        // Walk the user's global role's Reporting canDelete.
        const userRole = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            role: {
              select: {
                rolePermissions: {
                  where: { area: ApplicationArea.Reporting },
                  select: { canDelete: true },
                },
              },
            },
          },
        });
        if (userRole?.role?.rolePermissions.some((p) => p.canDelete)) {
          return true;
        }
      }
    }
  }

  return false;
}
