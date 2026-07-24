"use server";

import { ProjectAccessType } from "~/zenstack/models";
import { baseDb } from "~/lib/db";

/**
 * Get all users who should be displayed as "members" of a project
 * based on the project's access settings.
 *
 * - NO_ACCESS: Only explicitly assigned users (via direct assignment,
 *   a per-user project permission, or groups)
 * - GLOBAL_ROLE: All active users except those with access === 'NONE'
 * - SPECIFIC_ROLE: All active users except those with access === 'NONE'
 *
 * A per-user NO_ACCESS permission is the top of the precedence ladder and
 * removes the user from the result regardless of which path added them.
 */
export async function getProjectEffectiveMembers(
  projectId: number
): Promise<string[]> {
  try {
    // Get the project with default settings
    const project = await baseDb.projects.findUnique({
      where: { id: projectId },
      select: {
        defaultAccessType: true,
        defaultRoleId: true,
        assignedUsers: {
          where: { user: { isActive: true, isDeleted: false } },
          select: { userId: true },
        },
        userPermissions: {
          where: { user: { isActive: true, isDeleted: false } },
          select: { userId: true, accessType: true },
        },
        groupPermissions: {
          select: {
            accessType: true,
            group: {
              select: {
                assignedUsers: {
                  where: { user: { isActive: true, isDeleted: false } },
                  select: { userId: true },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return [];
    }

    const userIds = new Set<string>();
    const deniedUserIds = new Set<string>();

    // Always include directly assigned users
    project.assignedUsers.forEach((a) => userIds.add(a.userId));

    // Per-user project permissions grant membership on their own — a user
    // can hold a SPECIFIC_ROLE/GLOBAL_ROLE row without a ProjectAssignment
    // row, and those users are exactly the ones counted as role holders by
    // getProjectEligibleRoles. DEFAULT defers to the group/project layers
    // below, so it grants nothing by itself.
    project.userPermissions?.forEach((perm) => {
      if (perm.accessType === ProjectAccessType.NO_ACCESS) {
        deniedUserIds.add(perm.userId);
      } else if (perm.accessType !== ProjectAccessType.DEFAULT) {
        userIds.add(perm.userId);
      }
    });

    // Include users from groups with access
    project.groupPermissions?.forEach((perm) => {
      if (perm.accessType !== ProjectAccessType.NO_ACCESS) {
        perm.group?.assignedUsers?.forEach((a) => userIds.add(a.userId));
      }
    });

    // If project has GLOBAL_ROLE or SPECIFIC_ROLE default access,
    // include ALL active users except those with access === 'NONE'
    if (
      project.defaultAccessType === ProjectAccessType.GLOBAL_ROLE ||
      project.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE
    ) {
      // Get all active users except those with access === 'NONE'
      const allUsers = await baseDb.user.findMany({
        where: {
          isActive: true,
          isDeleted: false,
          access: { not: "NONE" },
        },
        select: { id: true },
      });

      allUsers.forEach((u) => userIds.add(u.id));
    }

    deniedUserIds.forEach((id) => userIds.delete(id));

    return Array.from(userIds);
  } catch (error) {
    console.error("Error getting project effective members:", error);
    return [];
  }
}
