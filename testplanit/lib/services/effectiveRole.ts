import { ProjectAccessType } from "~/zenstack/models";
import type { DbClient } from "~/lib/zenstack";

/**
 * Narrowest acceptable interface for the helpers below. Both the singleton
 * prisma client and a transaction handle satisfy it. Read-only operations
 * only — callers are responsible for upstream authorization.
 */
type EffectiveRolePrismaClient = Pick<
  DbClient,
  "userProjectPermission" | "user" | "groupProjectPermission" | "projects"
>;

/**
 * Resolve a single user's effective project role id using the same
 * precedence ladder enforced by app/api/get-user-permissions/route.ts:
 *   1. user-specific permission row (NO_ACCESS → null; GLOBAL_ROLE → user's
 *      global roleId; SPECIFIC_ROLE → row.roleId).
 *   2. group permission rows for any group the user belongs to
 *      (SPECIFIC_ROLE wins; DEFAULT defers to project default).
 *   3. project default access type (NO_ACCESS → null; GLOBAL_ROLE → user's
 *      global roleId; SPECIFIC_ROLE → project.defaultRoleId).
 *
 * Single source of truth for effective-role resolution. Consumed by BOTH
 * the request-time assignee check in app/actions/reviews.ts AND the
 * decide-time caller check in lib/services/reviewDecisions.ts so the two
 * surfaces can never drift.
 */
export async function resolveEffectiveProjectRoleId(
  userId: string,
  projectId: number,
  prismaClient: EffectiveRolePrismaClient
): Promise<number | null> {
  const [user, userPerm, project] = await Promise.all([
    prismaClient.user.findUnique({
      where: { id: userId },
      select: { id: true, roleId: true, groups: { select: { groupId: true } } },
    }),
    prismaClient.userProjectPermission.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { accessType: true, roleId: true },
    }),
    prismaClient.projects.findUnique({
      where: { id: projectId },
      select: { defaultAccessType: true, defaultRoleId: true },
    }),
  ]);

  if (!user || !project) return null;

  // 1. User-specific permission row.
  if (userPerm) {
    switch (userPerm.accessType) {
      case ProjectAccessType.NO_ACCESS:
        return null;
      case ProjectAccessType.GLOBAL_ROLE:
        return user.roleId ?? null;
      case ProjectAccessType.SPECIFIC_ROLE:
        return userPerm.roleId ?? null;
      case ProjectAccessType.DEFAULT:
        break;
    }
  }

  // 2. Group permission rows.
  if (user.groups.length > 0) {
    const groupIds = user.groups.map((g) => g.groupId);
    const groupPerms = await prismaClient.groupProjectPermission.findMany({
      where: {
        projectId,
        groupId: { in: groupIds },
        accessType: { not: ProjectAccessType.DEFAULT },
      },
      select: { accessType: true, roleId: true },
    });
    const specific = groupPerms.find(
      (p) => p.accessType === ProjectAccessType.SPECIFIC_ROLE
    );
    if (specific) return specific.roleId ?? null;
  }

  // 3. Project default.
  switch (project.defaultAccessType) {
    case ProjectAccessType.NO_ACCESS:
      return null;
    case ProjectAccessType.GLOBAL_ROLE:
      return user.roleId ?? null;
    case ProjectAccessType.SPECIFIC_ROLE:
      return project.defaultRoleId ?? null;
  }

  return null;
}

/**
 * Bulk variant of resolveEffectiveProjectRoleId. Resolves the effective
 * project role id for every userId in input using a fixed number of
 * Prisma queries (one user.findMany + one userProjectPermission.findMany +
 * one groupProjectPermission.findMany + one project.findUnique), regardless
 * of how many users are supplied. Returns Map<userId, roleId | null>.
 *
 * Same precedence ladder as the single-user variant.
 */
export async function resolveEffectiveProjectRolesForUsers(
  userIds: string[],
  projectId: number,
  prismaClient: EffectiveRolePrismaClient
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (userIds.length === 0) return result;

  const [users, userPerms, project] = await Promise.all([
    prismaClient.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, roleId: true, groups: { select: { groupId: true } } },
    }),
    prismaClient.userProjectPermission.findMany({
      where: { userId: { in: userIds }, projectId },
      select: { userId: true, accessType: true, roleId: true },
    }),
    prismaClient.projects.findUnique({
      where: { id: projectId },
      select: { defaultAccessType: true, defaultRoleId: true },
    }),
  ]);

  const userPermByUserId = new Map(userPerms.map((p) => [p.userId, p]));
  const allGroupIds = Array.from(
    new Set(users.flatMap((u) => u.groups.map((g) => g.groupId)))
  );

  const groupPerms =
    allGroupIds.length === 0
      ? []
      : await prismaClient.groupProjectPermission.findMany({
          where: {
            projectId,
            groupId: { in: allGroupIds },
            accessType: { not: ProjectAccessType.DEFAULT },
          },
          select: { groupId: true, accessType: true, roleId: true },
        });
  const groupPermsByGroupId = new Map<
    number,
    Array<{ accessType: ProjectAccessType; roleId: number | null }>
  >();
  for (const gp of groupPerms) {
    const list = groupPermsByGroupId.get(gp.groupId) ?? [];
    list.push({ accessType: gp.accessType, roleId: gp.roleId });
    groupPermsByGroupId.set(gp.groupId, list);
  }

  for (const userId of userIds) {
    const user = users.find((u) => u.id === userId);
    if (!user || !project) {
      result.set(userId, null);
      continue;
    }

    // 1. User-specific.
    const userPerm = userPermByUserId.get(userId);
    if (userPerm) {
      if (userPerm.accessType === ProjectAccessType.NO_ACCESS) {
        result.set(userId, null);
        continue;
      }
      if (userPerm.accessType === ProjectAccessType.GLOBAL_ROLE) {
        result.set(userId, user.roleId ?? null);
        continue;
      }
      if (userPerm.accessType === ProjectAccessType.SPECIFIC_ROLE) {
        result.set(userId, userPerm.roleId ?? null);
        continue;
      }
      // DEFAULT → fall through.
    }

    // 2. Group permissions.
    let decidedByGroup = false;
    for (const g of user.groups) {
      const perms = groupPermsByGroupId.get(g.groupId) ?? [];
      const specific = perms.find(
        (p) => p.accessType === ProjectAccessType.SPECIFIC_ROLE
      );
      if (specific) {
        result.set(userId, specific.roleId ?? null);
        decidedByGroup = true;
        break;
      }
    }
    if (decidedByGroup) continue;

    // 3. Project default.
    switch (project.defaultAccessType) {
      case ProjectAccessType.NO_ACCESS:
        result.set(userId, null);
        break;
      case ProjectAccessType.GLOBAL_ROLE:
        result.set(userId, user.roleId ?? null);
        break;
      case ProjectAccessType.SPECIFIC_ROLE:
        result.set(userId, project.defaultRoleId ?? null);
        break;
      default:
        result.set(userId, null);
    }
  }

  return result;
}
