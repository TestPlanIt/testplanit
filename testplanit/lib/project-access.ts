import { ProjectAccessType } from "@prisma/client";

/**
 * Builds a Prisma where clause for project access control.
 * This accounts for all access paths:
 * - Direct user permissions (userPermissions)
 * - Group permissions (groupPermissions)
 * - Project default GLOBAL_ROLE access type
 * - Direct assignment for PROJECTADMIN users
 *
 * @param projectId - The ID of the project (optional, if not provided returns condition without id filter)
 * @param userId - The ID of the user
 * @param isAdmin - Whether the user is an ADMIN
 * @param isProjectAdmin - Whether the user is a PROJECTADMIN
 * @returns Prisma where clause for project access
 */
export function buildProjectAccessWhere(
  projectId: number | undefined,
  userId: string,
  isAdmin: boolean,
  isProjectAdmin: boolean
) {
  const baseCondition = projectId !== undefined
    ? { id: projectId, isDeleted: false }
    : { isDeleted: false };

  if (isAdmin) {
    return baseCondition;
  }

  return {
    ...baseCondition,
    OR: [
      // Direct user permissions
      {
        userPermissions: {
          some: {
            userId: userId,
            accessType: { not: ProjectAccessType.NO_ACCESS },
          },
        },
      },
      // Group permissions
      {
        groupPermissions: {
          some: {
            group: {
              assignedUsers: {
                some: {
                  userId: userId,
                },
              },
            },
            accessType: { not: ProjectAccessType.NO_ACCESS },
          },
        },
      },
      // Project default GLOBAL_ROLE (any authenticated user with a role)
      {
        defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
      },
      // Direct assignment to project with PROJECTADMIN access
      ...(isProjectAdmin
        ? [
            {
              assignedUsers: {
                some: {
                  userId: userId,
                },
              },
            },
          ]
        : []),
    ],
  };
}

/**
 * Builds a Prisma condition for project access when used as a nested relation.
 * Similar to buildProjectAccessWhere but without the id and isDeleted fields.
 *
 * @param userId - The ID of the user
 * @param isAdmin - Whether the user is an ADMIN
 * @param isProjectAdmin - Whether the user is a PROJECTADMIN
 * @returns Prisma condition for project access (to be spread into parent query)
 */
export function buildProjectAccessCondition(
  userId: string,
  isAdmin: boolean,
  isProjectAdmin: boolean
) {
  if (isAdmin) {
    return {};
  }

  return {
    OR: [
      // Direct user permissions
      {
        userPermissions: {
          some: {
            userId: userId,
            accessType: { not: ProjectAccessType.NO_ACCESS },
          },
        },
      },
      // Group permissions
      {
        groupPermissions: {
          some: {
            group: {
              assignedUsers: {
                some: {
                  userId: userId,
                },
              },
            },
            accessType: { not: ProjectAccessType.NO_ACCESS },
          },
        },
      },
      // Project default GLOBAL_ROLE (any authenticated user with a role)
      {
        defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
      },
      // Direct assignment to project with PROJECTADMIN access
      ...(isProjectAdmin
        ? [
            {
              assignedUsers: {
                some: {
                  userId: userId,
                },
              },
            },
          ]
        : []),
    ],
  };
}
