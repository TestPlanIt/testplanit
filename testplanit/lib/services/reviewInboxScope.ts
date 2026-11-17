import { ProjectAccessType } from "~/zenstack/models";
import type { ReviewRequestWhereInput } from "~/zenstack/input";
import {
  REVIEW_RELEVANT_AREAS,
  areaForEntityType,
} from "~/lib/utils/reviewAreas";

/**
 * Who can be reached as a review assignee, per project.
 *
 * A review request is assigned to a user or to a role. "Assigned to a role
 * I hold" used to be answered with every role the viewer held anywhere —
 * the global role plus each SPECIFIC_ROLE grant — regardless of project.
 * The decide-time rule (`decideReviewRequest`) is stricter: the viewer's
 * effective role on the request's own project, with canApprove on the
 * entity's area. The inbox, its badges and the MCP tool listed rows the
 * viewer could not decide, and missed rows group-provisioned roles gave
 * them. This resolves the same per-project ladder as `effectiveRole.ts`
 * once, for the viewer, across every project, and turns it into a where
 * fragment every surface shares.
 */

export type ReviewEntityType = "CASE" | "RUN" | "SESSION";

export interface ReviewRoleScope {
  projectId: number;
  roleId: number;
  /** Entity types the role may approve in this project. */
  entityTypes: ReviewEntityType[];
}

export interface ReviewAssigneeScope {
  userId: string;
  isAdmin: boolean;
  /** Projects where an explicit grant or a SPECIFIC_ROLE default decides the role. */
  roleScopes: ReviewRoleScope[];
  /**
   * The viewer's global role, applied by project default (GLOBAL_ROLE)
   * wherever no explicit grant decides otherwise.
   */
  defaultGlobalRole: {
    roleId: number;
    entityTypes: ReviewEntityType[];
    /** Projects decided by an explicit grant or a SPECIFIC_ROLE default. */
    excludedProjectIds: number[];
  } | null;
}

type ScopeDb = {
  user: { findUnique: (args: any) => Promise<any> };
  userProjectPermission: { findMany: (args: any) => Promise<any[]> };
  groupProjectPermission: { findMany: (args: any) => Promise<any[]> };
  projects: { findMany: (args: any) => Promise<any[]> };
  rolePermission: { findMany: (args: any) => Promise<any[]> };
};

const ALL_ENTITY_TYPES: ReviewEntityType[] = ["CASE", "RUN", "SESSION"];

function entityTypeForArea(area: string): ReviewEntityType | null {
  for (const type of ALL_ENTITY_TYPES) {
    if (areaForEntityType(type) === area) return type;
  }
  return null;
}

export async function resolveReviewAssigneeScope(
  userId: string,
  db: ScopeDb
): Promise<ReviewAssigneeScope> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      roleId: true,
      access: true,
      groups: { select: { groupId: true } },
    },
  });
  if (!user)
    return { userId, isAdmin: false, roleScopes: [], defaultGlobalRole: null };
  const isAdmin = user.access === "ADMIN";
  const globalRoleId: number | null = user.roleId ?? null;

  // Same ladder as resolveEffectiveProjectRoleId, walked for every project
  // the viewer has an explicit footing in: user grant, then group grant,
  // then a SPECIFIC_ROLE project default. GLOBAL_ROLE defaults are not
  // enumerated; they become one relational clause below.
  const decided = new Map<number, number | null>();
  const userPerms = await db.userProjectPermission.findMany({
    where: { userId },
    select: { projectId: true, accessType: true, roleId: true },
  });
  for (const perm of userPerms) {
    switch (perm.accessType) {
      case ProjectAccessType.NO_ACCESS:
        decided.set(perm.projectId, null);
        break;
      case ProjectAccessType.GLOBAL_ROLE:
        decided.set(perm.projectId, globalRoleId);
        break;
      case ProjectAccessType.SPECIFIC_ROLE:
        decided.set(perm.projectId, perm.roleId ?? null);
        break;
      default:
        break;
    }
  }

  const groupIds: number[] = (user.groups ?? []).map(
    (g: { groupId: number }) => g.groupId
  );
  if (groupIds.length > 0) {
    const groupPerms = await db.groupProjectPermission.findMany({
      where: {
        groupId: { in: groupIds },
        accessType: { not: ProjectAccessType.DEFAULT },
      },
      select: { projectId: true, accessType: true, roleId: true },
    });
    const byProject = new Map<number, typeof groupPerms>();
    for (const perm of groupPerms) {
      if (decided.has(perm.projectId)) continue;
      byProject.set(perm.projectId, [
        ...(byProject.get(perm.projectId) ?? []),
        perm,
      ]);
    }
    for (const [projectId, perms] of byProject) {
      const specific = perms.find(
        (p) => p.accessType === ProjectAccessType.SPECIFIC_ROLE
      );
      if (specific) decided.set(projectId, specific.roleId ?? null);
      else if (
        perms.some((p) => p.accessType === ProjectAccessType.GLOBAL_ROLE)
      )
        decided.set(projectId, globalRoleId);
      else if (perms.every((p) => p.accessType === ProjectAccessType.NO_ACCESS))
        decided.set(projectId, null);
    }
  }

  const specificDefaults = await db.projects.findMany({
    where: {
      defaultAccessType: ProjectAccessType.SPECIFIC_ROLE,
      defaultRoleId: { not: null },
      isDeleted: false,
    },
    select: { id: true, defaultRoleId: true },
  });
  for (const project of specificDefaults) {
    if (!decided.has(project.id))
      decided.set(project.id, project.defaultRoleId ?? null);
  }

  // Which entity types each role may approve. Admins may decide anything.
  const roleIds = new Set<number>();
  for (const roleId of decided.values())
    if (roleId != null) roleIds.add(roleId);
  if (globalRoleId != null) roleIds.add(globalRoleId);
  const approvable = new Map<number, ReviewEntityType[]>();
  if (isAdmin) {
    for (const roleId of roleIds) approvable.set(roleId, [...ALL_ENTITY_TYPES]);
  } else if (roleIds.size > 0) {
    const perms = await db.rolePermission.findMany({
      where: {
        roleId: { in: Array.from(roleIds) },
        area: { in: [...REVIEW_RELEVANT_AREAS] },
        canApprove: true,
      },
      select: { roleId: true, area: true },
    });
    for (const perm of perms) {
      const type = entityTypeForArea(perm.area);
      if (!type) continue;
      approvable.set(perm.roleId, [
        ...(approvable.get(perm.roleId) ?? []),
        type,
      ]);
    }
  }

  const roleScopes: ReviewRoleScope[] = [];
  for (const [projectId, roleId] of decided) {
    if (roleId == null) continue;
    const entityTypes = approvable.get(roleId) ?? [];
    if (entityTypes.length > 0)
      roleScopes.push({ projectId, roleId, entityTypes });
  }
  roleScopes.sort((a, b) => a.projectId - b.projectId);

  const globalTypes =
    globalRoleId != null ? (approvable.get(globalRoleId) ?? []) : [];
  const defaultGlobalRole =
    globalRoleId != null && globalTypes.length > 0
      ? {
          roleId: globalRoleId,
          entityTypes: globalTypes,
          excludedProjectIds: Array.from(decided.keys()).sort((a, b) => a - b),
        }
      : null;

  return { userId, isAdmin, roleScopes, defaultGlobalRole };
}

/**
 * The OR branches that reach the viewer as an assignee: direct assignment,
 * one branch per project role, and the global role by project default.
 */
export function reviewAssigneeWhere(
  scope: ReviewAssigneeScope
): ReviewRequestWhereInput[] {
  const branches: ReviewRequestWhereInput[] = [
    { assigneeUserId: scope.userId },
  ];
  for (const s of scope.roleScopes) {
    branches.push({
      projectId: s.projectId,
      assigneeRoleId: s.roleId,
      entityType: { in: s.entityTypes },
    });
  }
  if (scope.defaultGlobalRole) {
    const d = scope.defaultGlobalRole;
    branches.push({
      assigneeRoleId: d.roleId,
      entityType: { in: d.entityTypes },
      project: {
        defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
        ...(d.excludedProjectIds.length > 0
          ? { id: { notIn: d.excludedProjectIds } }
          : {}),
      },
    });
  }
  return branches;
}

/** The same predicate, for one row already in hand (row actions). */
export function isReviewAssignee(
  scope: ReviewAssigneeScope,
  row: {
    projectId: number;
    assigneeUserId: string | null;
    assigneeRoleId: number | null;
    entityType: ReviewEntityType;
    /** The row's project default access type, when known. */
    projectDefaultAccessType?: string | null;
  }
): boolean {
  if (row.assigneeUserId === scope.userId) return true;
  if (row.assigneeRoleId == null) return false;
  const explicit = scope.roleScopes.find((s) => s.projectId === row.projectId);
  if (explicit) {
    return (
      explicit.roleId === row.assigneeRoleId &&
      explicit.entityTypes.includes(row.entityType)
    );
  }
  const d = scope.defaultGlobalRole;
  if (!d || d.excludedProjectIds.includes(row.projectId)) return false;
  if (
    row.projectDefaultAccessType != null &&
    row.projectDefaultAccessType !== ProjectAccessType.GLOBAL_ROLE
  ) {
    return false;
  }
  return (
    d.roleId === row.assigneeRoleId && d.entityTypes.includes(row.entityType)
  );
}
