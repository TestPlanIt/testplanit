import { ProjectAccessType } from "~/zenstack/models";
import { baseDb } from "~/lib/db";

/**
 * Every user who counts as a "member" of a project, given its access settings.
 *
 * - NO_ACCESS default: only explicitly granted users (direct assignment, a
 *   per-user project permission, or a group grant).
 * - GLOBAL_ROLE / SPECIFIC_ROLE default: every active user whose system access
 *   isn't NONE, plus the explicit grants above.
 *
 * A per-user NO_ACCESS permission tops the precedence ladder and removes the
 * user regardless of which path added them.
 *
 * This lives in lib/ rather than app/actions/ because workers call it — a
 * `"use server"` module can't be imported from a BullMQ worker. The server
 * action re-exports it.
 */
export async function getProjectEffectiveMemberIds(
  projectId: number
): Promise<string[]> {
  try {
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
