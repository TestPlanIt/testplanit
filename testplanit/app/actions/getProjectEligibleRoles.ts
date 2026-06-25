"use server";

import { ApplicationArea } from "~/zenstack/models";
import { baseDb } from "~/lib/db";

/**
 * Resolve the roles that are pickable as a review assignee for a project.
 *
 * A role appears in the list only when at least one user actually holds
 * the role on this project per the same eligibility union the decide
 * path uses (`NotificationService.resolveRoleHolderUserIds` /
 * `getProjectRoleHolders`). Four paths grant role-holder status:
 *
 *   1. UserProjectPermission with accessType = SPECIFIC_ROLE and matching roleId
 *   2. UserProjectPermission with accessType = GLOBAL_ROLE and the user's
 *      global User.roleId matches
 *   3. Group SPECIFIC_ROLE assignment with matching roleId (group member)
 *   4. Group GLOBAL_ROLE assignment (group member) with matching User.roleId
 *
 * The previous implementation collapsed to paths 2 + 4 only — it counted
 * users whose global role matched AND who had any effective project
 * access. That undercounted any user assigned the role per-project (path
 * 1 or 3) and produced a number that didn't match the actual reviewer
 * pool the decide path would resolve to.
 *
 * Returns an empty array on any failure rather than throwing — the
 * AssigneeCombobox already falls back to the users page when roles are
 * unavailable, and an unhealthy roles fetch should not block the user
 * from picking a user-kind reviewer.
 */
export async function getProjectEligibleRoles(
  projectId: number,
  options?: { requireCanApproveOn?: ApplicationArea }
): Promise<
  Array<{
    id: number;
    name: string;
    userCount: number;
  }>
> {
  try {
    // Union-of-paths reducer: walk every active role and ask "how many
    // distinct active users hold this role on this project?" The four
    // membership paths above each contribute to the per-role Set; we keep
    // only roles whose Set is non-empty so dead-end roles never reach the
    // picker.
    const allRoles = await baseDb.roles.findMany({
      where: {
        isDeleted: false,
        ...(options?.requireCanApproveOn && {
          rolePermissions: {
            some: {
              area: options.requireCanApproveOn,
              canApprove: true,
            },
          },
        }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    if (allRoles.length === 0) return [];

    const roleIds = allRoles.map((r) => r.id);
    const holdersByRole = new Map<number, Set<string>>();
    for (const id of roleIds) holdersByRole.set(id, new Set<string>());

    // Path 1 — UserProjectPermission SPECIFIC_ROLE.
    const specificRoleRows = await baseDb.userProjectPermission.findMany({
      where: {
        projectId,
        accessType: "SPECIFIC_ROLE",
        roleId: { in: roleIds },
        user: { isActive: true, isDeleted: false },
      },
      select: { roleId: true, userId: true },
    });
    for (const r of specificRoleRows) {
      if (r.roleId !== null) holdersByRole.get(r.roleId)?.add(r.userId);
    }

    // Path 2 — UserProjectPermission GLOBAL_ROLE (user's global roleId
    // is the role).
    const globalRoleRows = await baseDb.userProjectPermission.findMany({
      where: {
        projectId,
        accessType: "GLOBAL_ROLE",
        user: { isActive: true, isDeleted: false, roleId: { in: roleIds } },
      },
      select: { userId: true, user: { select: { roleId: true } } },
    });
    for (const r of globalRoleRows) {
      const rid = r.user?.roleId;
      if (rid != null) holdersByRole.get(rid)?.add(r.userId);
    }

    // Path 3 — Group SPECIFIC_ROLE.
    const groupSpecific = await baseDb.groupProjectPermission.findMany({
      where: {
        projectId,
        accessType: "SPECIFIC_ROLE",
        roleId: { in: roleIds },
      },
      select: {
        roleId: true,
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
    for (const perm of groupSpecific) {
      if (perm.roleId === null) continue;
      const bucket = holdersByRole.get(perm.roleId);
      if (!bucket) continue;
      perm.group?.assignedUsers.forEach((a) => bucket.add(a.userId));
    }

    // Path 4 — Group GLOBAL_ROLE (group member's global roleId is the role).
    const groupGlobal = await baseDb.groupProjectPermission.findMany({
      where: { projectId, accessType: "GLOBAL_ROLE" },
      select: {
        group: {
          select: {
            assignedUsers: {
              where: {
                user: {
                  isActive: true,
                  isDeleted: false,
                  roleId: { in: roleIds },
                },
              },
              select: {
                userId: true,
                user: { select: { roleId: true } },
              },
            },
          },
        },
      },
    });
    for (const perm of groupGlobal) {
      perm.group?.assignedUsers.forEach((a) => {
        const rid = a.user?.roleId;
        if (rid != null) holdersByRole.get(rid)?.add(a.userId);
      });
    }

    return allRoles
      .map((r) => ({
        id: r.id,
        name: r.name,
        userCount: holdersByRole.get(r.id)?.size ?? 0,
      }))
      .filter((r) => r.userCount > 0);
  } catch (error) {
    console.error("Error fetching project eligible roles:", error);
    return [];
  }
}
