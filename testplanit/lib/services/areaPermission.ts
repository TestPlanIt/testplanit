/**
 * Effective project permissions — the single source of truth for
 * "may user U do P on area A in project X".
 *
 * The ladder below was previously written out inline in
 * `app/api/get-user-permissions/route.ts`, which is what the UI asks before
 * showing a gated action. Any server-side gate that wants to *match* the UI
 * therefore has to answer with the same ladder, and a second hand-written copy
 * would drift. Both now call in here instead.
 *
 * Precedence, highest first:
 *   1. System access. ADMIN passes everything unconditionally. PROJECTADMIN
 *      passes everything on any project that does not explicitly deny them.
 *   2. The user's own UserProjectPermission row:
 *      NO_ACCESS denies · GLOBAL_ROLE uses the user's global role ·
 *      SPECIFIC_ROLE uses the row's role · DEFAULT defers downward.
 *   3. Group grants for any group the user belongs to: a SPECIFIC_ROLE grant
 *      wins over a GLOBAL_ROLE grant (which carries the member's own global
 *      role onto the project); DEFAULT defers downward.
 *   4. The project default: NO_ACCESS denies · GLOBAL_ROLE uses the user's
 *      global role · SPECIFIC_ROLE uses the project's default role.
 *
 * A resolved role with no RolePermission row for the area grants nothing.
 */

import { ApplicationArea, ProjectAccessType } from "~/zenstack/models";
import { baseDb } from "~/lib/db";

export type AreaPermissionKey = "canAddEdit" | "canDelete" | "canClose";

export interface AreaPermissions {
  canAddEdit: boolean;
  canDelete: boolean;
  canClose: boolean;
}

export const NO_AREA_PERMISSIONS: AreaPermissions = {
  canAddEdit: false,
  canDelete: false,
  canClose: false,
};

export const ALL_AREA_PERMISSIONS: AreaPermissions = {
  canAddEdit: true,
  canDelete: true,
  canClose: true,
};

interface RoleWithPermissions {
  id: number;
  name: string;
  rolePermissions: Array<
    { area: ApplicationArea } & Record<AreaPermissionKey, boolean>
  >;
}

/**
 * The resolved state of the ladder for one (user, project) pair, before it is
 * narrowed to a particular area. Callers that only need a yes/no should use
 * `userHasAreaPermission`; the route consumes the whole shape because it also
 * reports the role name and the deciding access type.
 */
export interface EffectiveProjectAccess {
  isSystemAdmin: boolean;
  isSystemProjectAdmin: boolean;
  /** An explicit NO_ACCESS, from the user's own row or the project default. */
  accessDenied: boolean;
  effectiveRole: RoleWithPermissions | null;
  /** The user's own row's access type, when they have one. */
  userAccessType: ProjectAccessType | null;
  /** Set when a group grant decided the role, so the reported access type
   *  names the deciding path rather than the project default. */
  groupAccessType: ProjectAccessType | null;
  projectDefaultAccessType: ProjectAccessType | null;
  /** False when the user or the project row does not exist. */
  resolved: boolean;
}

type AreaPermissionDb = Pick<
  typeof baseDb,
  "user" | "projects" | "userProjectPermission" | "groupProjectPermission"
>;

/** Permission bits a role carries on one area; absent row ⇒ nothing. */
export function permissionsForArea(
  role: RoleWithPermissions | null | undefined,
  area: ApplicationArea
): AreaPermissions {
  const perm = role?.rolePermissions.find((p) => p.area === area);
  if (!perm) return NO_AREA_PERMISSIONS;
  return {
    canAddEdit: perm.canAddEdit,
    canDelete: perm.canDelete,
    canClose: perm.canClose,
  };
}

/** Walks the precedence ladder documented at the top of this file. */
export async function resolveEffectiveProjectAccess(
  userId: string,
  projectId: number,
  db: AreaPermissionDb = baseDb
): Promise<EffectiveProjectAccess> {
  const [user, project, userProjectPermission] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { rolePermissions: true } },
        groups: { select: { groupId: true } },
      },
    }),
    db.projects.findUnique({
      where: { id: projectId },
      include: { defaultRole: { include: { rolePermissions: true } } },
    }),
    db.userProjectPermission.findUnique({
      where: { userId_projectId: { userId, projectId } },
      include: { role: { include: { rolePermissions: true } } },
    }),
  ]);

  if (!user || !project) {
    return {
      isSystemAdmin: false,
      isSystemProjectAdmin: false,
      accessDenied: false,
      effectiveRole: null,
      userAccessType: null,
      groupAccessType: null,
      projectDefaultAccessType: null,
      resolved: false,
    };
  }

  const access = (user as { access?: string }).access;
  const isSystemAdmin = access === "ADMIN";
  const isSystemProjectAdmin = access === "PROJECTADMIN";

  let effectiveRole: RoleWithPermissions | null = null;
  let accessDenied = false;
  let groupAccessType: ProjectAccessType | null = null;

  // 2. The user's own row.
  if (userProjectPermission) {
    switch (userProjectPermission.accessType) {
      case ProjectAccessType.NO_ACCESS:
        accessDenied = true;
        break;
      case ProjectAccessType.GLOBAL_ROLE:
        effectiveRole = (user.role as RoleWithPermissions | null) ?? null;
        break;
      case ProjectAccessType.SPECIFIC_ROLE:
        effectiveRole =
          (userProjectPermission.role as RoleWithPermissions | null) ?? null;
        break;
      case ProjectAccessType.DEFAULT:
        break;
    }
  }

  // 3. Group grants.
  if (!accessDenied && !effectiveRole && user.groups.length > 0) {
    const groupPermissions = await db.groupProjectPermission.findMany({
      where: {
        projectId,
        groupId: { in: user.groups.map((g) => g.groupId) },
        accessType: { not: ProjectAccessType.DEFAULT },
      },
      include: { role: { include: { rolePermissions: true } } },
    });

    const specific = groupPermissions.find(
      (p) => p.accessType === ProjectAccessType.SPECIFIC_ROLE
    );
    const global = groupPermissions.find(
      (p) => p.accessType === ProjectAccessType.GLOBAL_ROLE
    );

    if (specific) {
      effectiveRole = (specific.role as RoleWithPermissions | null) ?? null;
      groupAccessType = ProjectAccessType.SPECIFIC_ROLE;
    } else if (global) {
      // A group granted GLOBAL_ROLE access carries the member's own global
      // role onto the project.
      effectiveRole = (user.role as RoleWithPermissions | null) ?? null;
      if (effectiveRole) groupAccessType = ProjectAccessType.GLOBAL_ROLE;
    }
  }

  // 4. Project default.
  if (!accessDenied && !effectiveRole) {
    switch (project.defaultAccessType) {
      case ProjectAccessType.NO_ACCESS:
        accessDenied = true;
        break;
      case ProjectAccessType.GLOBAL_ROLE:
        effectiveRole = (user.role as RoleWithPermissions | null) ?? null;
        break;
      case ProjectAccessType.SPECIFIC_ROLE:
        effectiveRole =
          (project.defaultRole as RoleWithPermissions | null) ?? null;
        break;
    }
  }

  return {
    isSystemAdmin,
    isSystemProjectAdmin,
    accessDenied,
    effectiveRole,
    userAccessType: userProjectPermission?.accessType ?? null,
    groupAccessType,
    projectDefaultAccessType: project.defaultAccessType,
    resolved: true,
  };
}

/** Narrows a resolved ladder to one area's permission bits. */
export function areaPermissionsFrom(
  resolution: EffectiveProjectAccess,
  area: ApplicationArea
): AreaPermissions {
  if (!resolution.resolved) return NO_AREA_PERMISSIONS;
  if (
    resolution.isSystemAdmin ||
    (resolution.isSystemProjectAdmin && !resolution.accessDenied)
  ) {
    return ALL_AREA_PERMISSIONS;
  }
  if (resolution.accessDenied || !resolution.effectiveRole) {
    return NO_AREA_PERMISSIONS;
  }
  return permissionsForArea(resolution.effectiveRole, area);
}

/** Whether the ladder grants the user project access at all. */
export function hasProjectAccess(resolution: EffectiveProjectAccess): boolean {
  if (!resolution.resolved) return false;
  return (
    resolution.isSystemAdmin ||
    resolution.isSystemProjectAdmin ||
    (!resolution.accessDenied && resolution.effectiveRole !== null)
  );
}

/**
 * The question most callers actually have. One ladder walk, then one bit.
 */
export async function userHasAreaPermission(
  userId: string,
  projectId: number,
  area: ApplicationArea,
  permission: AreaPermissionKey,
  db: AreaPermissionDb = baseDb
): Promise<boolean> {
  const resolution = await resolveEffectiveProjectAccess(userId, projectId, db);
  return areaPermissionsFrom(resolution, area)[permission];
}

/**
 * Every role carrying `permission` on `area`. The inverse direction, for
 * fanouts that need the set of users who could act rather than a yes/no about
 * one of them.
 */
export async function resolveEligibleRoleIds(
  area: ApplicationArea,
  permission: AreaPermissionKey,
  db: Pick<typeof baseDb, "rolePermission"> = baseDb
): Promise<Set<number>> {
  const rows = await db.rolePermission.findMany({
    where: { area, [permission]: true },
    select: { roleId: true },
  });
  return new Set(rows.map((r) => r.roleId));
}
