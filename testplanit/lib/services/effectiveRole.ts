import { ProjectAccessType } from "~/zenstack/models";
import type { DbClient } from "~/lib/zenstack";

/**
 * Narrowest acceptable interface for the helpers below. Both the singleton
 * db client and a transaction handle satisfy it. Read-only operations
 * only — callers are responsible for upstream authorization.
 */
type EffectiveRoleDbClient = Pick<
  DbClient,
  "userProjectPermission" | "user" | "groupProjectPermission" | "projects"
>;

/**
 * Resolve a single user's effective project role id using the same
 * precedence ladder enforced by app/api/get-user-permissions/route.ts:
 *   1. user-specific permission row (NO_ACCESS → null; GLOBAL_ROLE → user's
 *      global roleId; SPECIFIC_ROLE → row.roleId).
 *   2. group permission rows for any group the user belongs to
 *      (SPECIFIC_ROLE wins; GLOBAL_ROLE → the user's own global roleId;
 *      DEFAULT defers to project default).
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
  dbClient: EffectiveRoleDbClient
): Promise<number | null> {
  const [user, userPerm, project] = await Promise.all([
    dbClient.user.findUnique({
      where: { id: userId },
      select: { id: true, roleId: true, groups: { select: { groupId: true } } },
    }),
    dbClient.userProjectPermission.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { accessType: true, roleId: true },
    }),
    dbClient.projects.findUnique({
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
    const groupPerms = await dbClient.groupProjectPermission.findMany({
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
    // A group granted GLOBAL_ROLE access carries the member's own global
    // role onto the project — the same membership path counted as path 4
    // by getProjectEligibleRoles / resolveRoleHolderUserIds and matched by
    // `isRoleHolderViaGroupGlobal` in the decide gate.
    const global = groupPerms.find(
      (p) => p.accessType === ProjectAccessType.GLOBAL_ROLE
    );
    if (global) return user.roleId ?? null;
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

/** Which rung of the ladder decided a user's effective role. */
export type EffectiveRoleSource =
  "USER_PERMISSION" | "GROUP_PERMISSION" | "PROJECT_DEFAULT";

export interface EffectiveProjectRoleResolution {
  roleId: number | null;
  /** Null when the user or project row does not exist. */
  source: EffectiveRoleSource | null;
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
  dbClient: EffectiveRoleDbClient
): Promise<Map<string, number | null>> {
  const resolutions = await resolveEffectiveProjectAccessForUsers(
    userIds,
    projectId,
    dbClient
  );
  return new Map(
    Array.from(resolutions, ([userId, { roleId }]) => [userId, roleId])
  );
}

/**
 * Same walk as resolveEffectiveProjectRolesForUsers, but also reports which
 * rung decided each user so callers that display the answer can say where it
 * came from. A NO_ACCESS row still names its rung with a null roleId.
 */
export async function resolveEffectiveProjectAccessForUsers(
  userIds: string[],
  projectId: number,
  dbClient: EffectiveRoleDbClient
): Promise<Map<string, EffectiveProjectRoleResolution>> {
  const result = new Map<string, EffectiveProjectRoleResolution>();
  if (userIds.length === 0) return result;

  const [users, userPerms, project] = await Promise.all([
    dbClient.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, roleId: true, groups: { select: { groupId: true } } },
    }),
    dbClient.userProjectPermission.findMany({
      where: { userId: { in: userIds }, projectId },
      select: { userId: true, accessType: true, roleId: true },
    }),
    dbClient.projects.findUnique({
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
      : await dbClient.groupProjectPermission.findMany({
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

  const userMap = new Map(users.map((u) => [u.id, u]));

  for (const userId of userIds) {
    const user = userMap.get(userId);
    if (!user || !project) {
      result.set(userId, { roleId: null, source: null });
      continue;
    }

    // 1. User-specific.
    const userPerm = userPermByUserId.get(userId);
    if (userPerm) {
      if (userPerm.accessType === ProjectAccessType.NO_ACCESS) {
        result.set(userId, { roleId: null, source: "USER_PERMISSION" });
        continue;
      }
      if (userPerm.accessType === ProjectAccessType.GLOBAL_ROLE) {
        result.set(userId, {
          roleId: user.roleId ?? null,
          source: "USER_PERMISSION",
        });
        continue;
      }
      if (userPerm.accessType === ProjectAccessType.SPECIFIC_ROLE) {
        result.set(userId, {
          roleId: userPerm.roleId ?? null,
          source: "USER_PERMISSION",
        });
        continue;
      }
      // DEFAULT → fall through.
    }

    // 2. Group permissions. SPECIFIC_ROLE anywhere in the user's groups
    // wins over a GLOBAL_ROLE grant, so both passes run across the flattened
    // permission list rather than short-circuiting on the first group.
    const userGroupPerms = user.groups.flatMap(
      (g) => groupPermsByGroupId.get(g.groupId) ?? []
    );
    const groupSpecific = userGroupPerms.find(
      (p) => p.accessType === ProjectAccessType.SPECIFIC_ROLE
    );
    if (groupSpecific) {
      result.set(userId, {
        roleId: groupSpecific.roleId ?? null,
        source: "GROUP_PERMISSION",
      });
      continue;
    }
    const groupGlobal = userGroupPerms.find(
      (p) => p.accessType === ProjectAccessType.GLOBAL_ROLE
    );
    if (groupGlobal) {
      result.set(userId, {
        roleId: user.roleId ?? null,
        source: "GROUP_PERMISSION",
      });
      continue;
    }

    // 3. Project default.
    switch (project.defaultAccessType) {
      case ProjectAccessType.GLOBAL_ROLE:
        result.set(userId, {
          roleId: user.roleId ?? null,
          source: "PROJECT_DEFAULT",
        });
        break;
      case ProjectAccessType.SPECIFIC_ROLE:
        result.set(userId, {
          roleId: project.defaultRoleId ?? null,
          source: "PROJECT_DEFAULT",
        });
        break;
      default:
        result.set(userId, { roleId: null, source: "PROJECT_DEFAULT" });
    }
  }

  return result;
}
