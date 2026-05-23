"use server";

import { prisma } from "~/lib/prisma";

/**
 * Resolve the user list that would receive a role-assigned review for a
 * given (project, role) pair. Used by the pending-review banner to render
 * a hover tooltip naming everyone who could act on the request.
 *
 * Mirrors the membership semantics of
 * `NotificationService.resolveRoleHolderUserIds` but without the requester
 * exclusion — the tooltip is a "who can approve this" surface, so the
 * requester themselves should appear if they happen to hold the role (the
 * decide path still blocks self-approve via the schema @@validate).
 *
 * Three eligibility paths:
 *   - SPECIFIC_ROLE via UserProjectPermission where `roleId === roleId`
 *   - GLOBAL_ROLE via UserProjectPermission where the user's global
 *     `roleId === roleId`
 *   - SPECIFIC_ROLE / GLOBAL_ROLE via GroupProjectPermission with a
 *     matching role assignment
 *
 * Returns an empty array on any failure rather than throwing — the
 * tooltip should degrade silently to "no preview available" rather than
 * crashing the banner.
 */
export async function getProjectRoleHolders(
  projectId: number,
  roleId: number
): Promise<
  Array<{
    id: string;
    name: string | null;
    image: string | null;
  }>
> {
  try {
    const userIds = new Set<string>();

    // Direct user assignments: SPECIFIC_ROLE rows whose roleId matches.
    const specificRoleRows = await prisma.userProjectPermission.findMany({
      where: {
        projectId,
        accessType: "SPECIFIC_ROLE",
        roleId,
        user: { isActive: true, isDeleted: false },
      },
      select: { userId: true },
    });
    specificRoleRows.forEach((r) => userIds.add(r.userId));

    // Direct user assignments: GLOBAL_ROLE rows where the user's own global
    // role matches.
    const globalRoleRows = await prisma.userProjectPermission.findMany({
      where: {
        projectId,
        accessType: "GLOBAL_ROLE",
        user: { isActive: true, isDeleted: false, roleId },
      },
      select: { userId: true },
    });
    globalRoleRows.forEach((r) => userIds.add(r.userId));

    // Group-based assignments — SPECIFIC_ROLE.
    const groupSpecific = await prisma.groupProjectPermission.findMany({
      where: { projectId, accessType: "SPECIFIC_ROLE", roleId },
      select: {
        group: {
          select: {
            assignedUsers: {
              where: { user: { isActive: true, isDeleted: false } },
              select: { userId: true },
            },
          },
        },
      },
    });
    groupSpecific.forEach((p) =>
      p.group?.assignedUsers.forEach((a) => userIds.add(a.userId))
    );

    // Group-based assignments — GLOBAL_ROLE.
    const groupGlobal = await prisma.groupProjectPermission.findMany({
      where: { projectId, accessType: "GLOBAL_ROLE" },
      select: {
        group: {
          select: {
            assignedUsers: {
              where: {
                user: { isActive: true, isDeleted: false, roleId },
              },
              select: { userId: true },
            },
          },
        },
      },
    });
    groupGlobal.forEach((p) =>
      p.group?.assignedUsers.forEach((a) => userIds.add(a.userId))
    );

    if (userIds.size === 0) return [];

    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, name: true, image: true },
      orderBy: { name: "asc" },
    });
    return users;
  } catch (err) {
    console.error("getProjectRoleHolders failed", err);
    return [];
  }
}
