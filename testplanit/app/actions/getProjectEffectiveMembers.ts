"use server";

import { ProjectAccessType } from "@prisma/client";
import { prisma } from "~/lib/prisma";

/**
 * Get all users who should be displayed as "members" of a project
 * based on the project's access settings.
 *
 * - NO_ACCESS: Only explicitly assigned users (via direct assignment or groups)
 * - GLOBAL_ROLE: All active users except those with access === 'NONE'
 * - SPECIFIC_ROLE: All active users except those with access === 'NONE'
 */
export async function getProjectEffectiveMembers(
  projectId: number
): Promise<string[]> {
  try {
    // Get the project with default settings
    const project = await prisma.projects.findUnique({
      where: { id: projectId },
      select: {
        defaultAccessType: true,
        defaultRoleId: true,
        assignedUsers: {
          where: { user: { isActive: true, isDeleted: false } },
          select: { userId: true },
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

    // Always include directly assigned users
    project.assignedUsers.forEach((a) => userIds.add(a.userId));

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
      const allUsers = await prisma.user.findMany({
        where: {
          isActive: true,
          isDeleted: false,
          access: { not: "NONE" },
        },
        select: { id: true },
      });

      allUsers.forEach((u) => userIds.add(u.id));
    }

    return Array.from(userIds);
  } catch (error) {
    console.error("Error getting project effective members:", error);
    return [];
  }
}
