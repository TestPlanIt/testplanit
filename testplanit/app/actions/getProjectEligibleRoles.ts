"use server";

import { ApplicationArea } from "~/zenstack/models";
import { baseDb } from "~/lib/db";
import { getServerAuthSession } from "~/server/auth";

/**
 * Users the notification worker would drop on delivery: an explicit NONE
 * preference, or USE_GLOBAL (the implied mode when the user has no
 * preferences row) while the global default mode is NONE. Mirrors the
 * JOB_CREATE_NOTIFICATION branch of workers/notificationWorker.ts.
 */
async function resolveSilencedUserIds(userIds: string[]): Promise<Set<string>> {
  const silenced = new Set<string>();
  if (userIds.length === 0) return silenced;

  const [prefs, globalSettings] = await Promise.all([
    baseDb.userPreferences.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, notificationMode: true },
    }),
    baseDb.appConfig.findUnique({
      where: { key: "notificationSettings" },
      select: { value: true },
    }),
  ]);

  const globalMode =
    (globalSettings?.value as { defaultMode?: string } | null)?.defaultMode ||
    "IN_APP";
  const modeByUser = new Map(prefs.map((p) => [p.userId, p.notificationMode]));

  for (const userId of userIds) {
    const mode = modeByUser.get(userId) || "USE_GLOBAL";
    if (mode === "NONE" || (mode === "USE_GLOBAL" && globalMode === "NONE")) {
      silenced.add(userId);
    }
  }

  return silenced;
}

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
 * Two counts come back per role, because they answer different questions:
 *
 *   - `userCount` — every holder. Drives role visibility: a role with no
 *     holders is a dead-end assignment the decide path would resolve to
 *     zero reviewers, so it never reaches the picker.
 *   - `notifyCount` — holders who actually receive the REVIEW_REQUESTED
 *     notification, matching `resolveRoleHolderUserIds` exactly: the
 *     requester is dropped (you don't get pinged about your own request)
 *     and so is anyone the notification worker would skip for having
 *     notifications turned off.
 *
 * A role can therefore be selectable while notifying nobody — silenced
 * holders still see the request in their review inbox and can decide it,
 * so hiding the role would remove a legitimate assignment target.
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
    notifyCount: number;
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

    const session = await getServerAuthSession();
    const requesterUserId = session?.user?.id ?? null;

    const recipientCandidates = new Set<string>();
    for (const holders of holdersByRole.values()) {
      for (const userId of holders) {
        if (userId !== requesterUserId) recipientCandidates.add(userId);
      }
    }
    const silencedUserIds = await resolveSilencedUserIds(
      Array.from(recipientCandidates)
    );

    return allRoles
      .map((r) => {
        const holders = holdersByRole.get(r.id) ?? new Set<string>();
        let notifyCount = 0;
        for (const userId of holders) {
          if (userId === requesterUserId) continue;
          if (silencedUserIds.has(userId)) continue;
          notifyCount++;
        }
        return {
          id: r.id,
          name: r.name,
          userCount: holders.size,
          notifyCount,
        };
      })
      .filter((r) => r.userCount > 0);
  } catch (error) {
    console.error("Error fetching project eligible roles:", error);
    return [];
  }
}
