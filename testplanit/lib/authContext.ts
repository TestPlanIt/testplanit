import { ProjectAccessType } from "~/zenstack/models";
import { baseDb } from "~/lib/db";

/**
 * The user shape callers already have in hand — a User row loaded with its role
 * and that role's permission grid. Matches `getUserWithRole` and the
 * `include: { role: { include: { rolePermissions: true } } }` fetch used by the
 * export and stream routes.
 */
export interface UserForAuth {
  id: string;
  access: string;
  roleId: number | null;
  role?: {
    id: number;
    name: string;
    rolePermissions?: Array<{
      area: string;
      canAddEdit: boolean;
      canDelete: boolean;
      canClose: boolean;
      canReadSensitive: boolean;
      canApprove: boolean;
    }> | null;
  } | null;
}

/**
 * Resolve every project this user may read.
 *
 * This reproduces, once per request, the precedence ladder the per-model read
 * rules used to evaluate per row. A project qualifies when any branch holds:
 *
 *   1. the user created it
 *   2. a UserProjectPermission row with SPECIFIC_ROLE
 *   3. a UserProjectPermission row with GLOBAL_ROLE
 *   4. membership of a group whose GroupProjectPermission grants SPECIFIC_ROLE
 *      (with a role) or GLOBAL_ROLE (and the user carries a global role)
 *   5. project default GLOBAL_ROLE, the user has a global role, access != NONE
 *   6. an explicit ProjectAssignment plus project default SPECIFIC_ROLE with a
 *      default role
 *   7. project default SPECIFIC_ROLE with a default role, access != NONE
 *   8. project default DEFAULT, access != NONE
 *
 * A per-user NO_ACCESS permission removes the project whichever branch added
 * it — this is the `@@deny('read', …NO_ACCESS…)` rule that used to sit beside
 * each read policy, folded in here so the id list is self-contained.
 *
 * Soft-deleted projects are NOT filtered out: the previous predicates did not
 * consider `Projects.isDeleted`, and every model already filters its own
 * `isDeleted` at query time. Excluding them here would silently narrow access
 * relative to the rules this replaces.
 */
export async function resolveAccessibleProjectIds(
  user: UserForAuth
): Promise<number[]> {
  const hasGlobalRole = user.roleId != null;
  const notNoAccess = user.access !== "NONE";

  const [projects, userPerms, groupPerms, assignments] = await Promise.all([
    baseDb.projects.findMany({
      select: {
        id: true,
        createdBy: true,
        defaultAccessType: true,
        defaultRoleId: true,
      },
    }),
    baseDb.userProjectPermission.findMany({
      where: { userId: user.id },
      select: { projectId: true, accessType: true },
    }),
    baseDb.groupProjectPermission.findMany({
      where: { group: { assignedUsers: { some: { userId: user.id } } } },
      select: { projectId: true, accessType: true, roleId: true },
    }),
    baseDb.projectAssignment.findMany({
      where: { userId: user.id },
      select: { projectId: true },
    }),
  ]);

  const userPermByProject = new Map(
    userPerms.map((p) => [p.projectId, p.accessType])
  );
  const assignedProjectIds = new Set(assignments.map((a) => a.projectId));

  const groupGrantedProjectIds = new Set<number>();
  for (const perm of groupPerms) {
    if (
      (perm.accessType === ProjectAccessType.SPECIFIC_ROLE &&
        perm.roleId != null) ||
      (perm.accessType === ProjectAccessType.GLOBAL_ROLE && hasGlobalRole)
    ) {
      groupGrantedProjectIds.add(perm.projectId);
    }
  }

  const accessible: number[] = [];
  for (const project of projects) {
    // A per-user NO_ACCESS row outranks every grant below.
    if (userPermByProject.get(project.id) === ProjectAccessType.NO_ACCESS) {
      continue;
    }

    const userPerm = userPermByProject.get(project.id);
    const granted =
      project.createdBy === user.id ||
      userPerm === ProjectAccessType.SPECIFIC_ROLE ||
      userPerm === ProjectAccessType.GLOBAL_ROLE ||
      groupGrantedProjectIds.has(project.id) ||
      (project.defaultAccessType === ProjectAccessType.GLOBAL_ROLE &&
        hasGlobalRole &&
        notNoAccess) ||
      (assignedProjectIds.has(project.id) &&
        project.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE &&
        project.defaultRoleId != null) ||
      (project.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE &&
        project.defaultRoleId != null &&
        notNoAccess) ||
      (project.defaultAccessType === ProjectAccessType.DEFAULT && notNoAccess);

    if (granted) accessible.push(project.id);
  }

  return accessible;
}

/**
 * Build the `AuthCtx` value the access policies are evaluated against.
 *
 * MUST be called per request. Caching the result in the session would leave a
 * revoked project permission in force until the user next signs in — trading a
 * security regression for a saved round trip.
 */
export async function buildAuthContext(user: UserForAuth) {
  const accessibleProjectIds = await resolveAccessibleProjectIds(user);

  return {
    id: user.id,
    access: user.access,
    roleId: user.roleId ?? null,
    role: user.role
      ? {
          id: user.role.id,
          name: user.role.name,
          rolePermissions: (user.role.rolePermissions ?? []).map((p) => ({
            area: p.area,
            canAddEdit: p.canAddEdit,
            canDelete: p.canDelete,
            canClose: p.canClose,
            canReadSensitive: p.canReadSensitive,
            canApprove: p.canApprove,
          })),
        }
      : null,
    accessibleProjectIds,
  };
}
