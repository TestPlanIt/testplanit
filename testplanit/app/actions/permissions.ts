"use server";

import {
  ApplicationArea,
  ProjectAccessType,
  Roles,
} from "@prisma/client";
import { prisma } from "~/lib/prisma";
import { isAdmin, isProjectAdmin } from "~/utils/permissions";
import { Session } from "next-auth";

// Type for permissions of a single area
export type AreaPermissions = {
  canAddEdit: boolean;
  canDelete: boolean;
  canClose: boolean;
};

// Type for permissions across all areas
export type AllAreaPermissions = Record<ApplicationArea, AreaPermissions>;

// Helper type for Role with its permissions included
type RoleWithPermissions = Roles & {
  rolePermissions: {
    area: ApplicationArea;
    canAddEdit: boolean;
    canDelete: boolean;
    canClose: boolean;
  }[];
};

// Helper function to get permissions for a specific role and area
function getPermissionsForArea(
  role: RoleWithPermissions | null | undefined,
  area: ApplicationArea
): AreaPermissions {
  const defaultPerms: AreaPermissions = {
    canAddEdit: false,
    canDelete: false,
    canClose: false,
  };
  if (!role) {
    return defaultPerms;
  }
  const specificPerm = role.rolePermissions.find((p) => p.area === area);
  return specificPerm
    ? {
        canAddEdit: specificPerm.canAddEdit,
        canDelete: specificPerm.canDelete,
        canClose: specificPerm.canClose,
      }
    : defaultPerms;
}

export interface UserProjectPermissionsResult {
  hasAccess: boolean;
  effectiveRole: string | null;
  permissions: AreaPermissions | AllAreaPermissions;
}

/**
 * Get user permissions for a specific project and optionally a specific application area.
 * This is the server-side function that can be called from server actions.
 *
 * @param userId - The user ID to check permissions for
 * @param projectId - The project ID to check permissions in
 * @param session - The current session (used to check for admin/projectadmin status)
 * @param area - Optional specific application area to get permissions for
 * @returns The user's permissions for the project/area
 */
export async function getUserProjectPermissions(
  userId: string,
  projectId: number,
  session: Session | null,
  area?: ApplicationArea
): Promise<UserProjectPermissionsResult> {
  const defaultResult: UserProjectPermissionsResult = {
    hasAccess: false,
    effectiveRole: null,
    permissions: area
      ? { canAddEdit: false, canDelete: false, canClose: false }
      : (Object.values(ApplicationArea).reduce(
          (acc, key) => {
            acc[key] = { canAddEdit: false, canDelete: false, canClose: false };
            return acc;
          },
          {} as AllAreaPermissions
        )),
  };

  // Fetch all necessary data in parallel
  const [user, project, userProjectPermission] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { rolePermissions: true } },
        groups: { select: { groupId: true } },
      },
    }),
    prisma.projects.findUnique({
      where: { id: projectId },
      include: {
        defaultRole: { include: { rolePermissions: true } },
      },
    }),
    prisma.userProjectPermission.findUnique({
      where: { userId_projectId: { userId, projectId } },
      include: {
        role: { include: { rolePermissions: true } },
      },
    }),
  ]);

  if (!user || !project) {
    return defaultResult;
  }

  let effectiveRole: RoleWithPermissions | null | undefined = null;
  let accessDenied = false;

  // Check if user is a System ADMIN or PROJECTADMIN
  const isSystemAdmin = isAdmin(session);
  const isSystemProjectAdmin = isProjectAdmin(session);

  // Determine Effective Role based on precedence

  // User Specific Permission
  if (userProjectPermission) {
    switch (userProjectPermission.accessType) {
      case ProjectAccessType.NO_ACCESS:
        accessDenied = true;
        break;
      case ProjectAccessType.GLOBAL_ROLE:
        effectiveRole = user.role as RoleWithPermissions | null;
        break;
      case ProjectAccessType.SPECIFIC_ROLE:
        effectiveRole =
          userProjectPermission.role as RoleWithPermissions | null;
        break;
      case ProjectAccessType.DEFAULT:
        // Defer to groups/project defaults
        break;
    }
  }

  // Group Permissions (if not decided by user-specific)
  if (!accessDenied && !effectiveRole && user.groups.length > 0) {
    const groupIds = user.groups.map((g) => g.groupId);
    const groupPermissions = await prisma.groupProjectPermission.findMany({
      where: {
        projectId: projectId,
        groupId: { in: groupIds },
        accessType: { not: ProjectAccessType.DEFAULT },
      },
      include: {
        role: { include: { rolePermissions: true } },
      },
      orderBy: {
        accessType: "asc",
      },
    });

    const specificRolePermission = groupPermissions.find(
      (p) => p.accessType === ProjectAccessType.SPECIFIC_ROLE
    );

    if (specificRolePermission) {
      effectiveRole =
        specificRolePermission.role as RoleWithPermissions | null;
    }
  }

  // Project Default Permissions (if not decided yet)
  if (!accessDenied && !effectiveRole) {
    switch (project.defaultAccessType) {
      case ProjectAccessType.NO_ACCESS:
        accessDenied = true;
        break;
      case ProjectAccessType.GLOBAL_ROLE:
        effectiveRole = user.role as RoleWithPermissions | null;
        break;
      case ProjectAccessType.SPECIFIC_ROLE:
        effectiveRole = project.defaultRole as RoleWithPermissions | null;
        break;
    }
  }

  // Get Permissions from Effective Role
  let permissions: AreaPermissions | AllAreaPermissions;

  // System ADMINs always have full permissions
  // System PROJECTADMINs have full permissions on projects they can access
  if (isSystemAdmin || (isSystemProjectAdmin && !accessDenied)) {
    if (area) {
      permissions = { canAddEdit: true, canDelete: true, canClose: true };
    } else {
      permissions = Object.values(ApplicationArea).reduce(
        (acc, enumArea) => {
          acc[enumArea] = { canAddEdit: true, canDelete: true, canClose: true };
          return acc;
        },
        {} as AllAreaPermissions
      );
    }
    return {
      hasAccess: true,
      effectiveRole: isSystemAdmin ? "System Admin" : "System Project Admin",
      permissions,
    };
  } else if (!accessDenied && effectiveRole) {
    if (area) {
      permissions = getPermissionsForArea(effectiveRole, area);
    } else {
      permissions = Object.values(ApplicationArea).reduce(
        (acc, enumArea) => {
          acc[enumArea] = getPermissionsForArea(effectiveRole, enumArea);
          return acc;
        },
        {} as AllAreaPermissions
      );
    }
    return {
      hasAccess: true,
      effectiveRole: effectiveRole?.name || null,
      permissions,
    };
  }

  // Access denied or no effective role
  return defaultResult;
}

/**
 * Check if a user has a specific permission for an application area in a project.
 *
 * @param userId - The user ID to check permissions for
 * @param projectId - The project ID to check permissions in
 * @param session - The current session
 * @param area - The application area to check
 * @param permission - The specific permission to check ('canAddEdit', 'canDelete', or 'canClose')
 * @returns true if the user has the specified permission
 */
export async function checkUserPermission(
  userId: string,
  projectId: number,
  session: Session | null,
  area: ApplicationArea,
  permission: keyof AreaPermissions
): Promise<boolean> {
  const result = await getUserProjectPermissions(userId, projectId, session, area);
  if (!result.hasAccess) {
    return false;
  }
  return (result.permissions as AreaPermissions)[permission];
}
