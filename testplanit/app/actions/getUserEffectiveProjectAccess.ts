"use server";

import { ProjectAccessType } from "@prisma/client";
import { prisma } from "~/lib/prisma";

export interface UserEffectiveAccess {
  userId: string;
  accessType: ProjectAccessType | "PROJECT_DEFAULT";
  roleId: number | null;
  effectiveAccessType: ProjectAccessType;
  effectiveRoleId: number | null;
}

export async function getUserEffectiveProjectAccess(
  projectId: number,
  userId: string
): Promise<UserEffectiveAccess | null> {
  try {
    // Get the project with default settings
    const project = await prisma.projects.findUnique({
      where: { id: projectId },
      select: {
        defaultAccessType: true,
        defaultRoleId: true,
      },
    });

    if (!project) {
      return null;
    }

    // Get the user with their role
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        roleId: true,
        access: true,
      },
    });

    if (!user) {
      return null;
    }

    // Check for explicit user permission
    const userPermission = await prisma.userProjectPermission.findUnique({
      where: {
        userId_projectId: {
          userId: userId,
          projectId: projectId,
        },
      },
      select: {
        accessType: true,
        roleId: true,
      },
    });

    // If user has explicit permission, use it
    if (userPermission) {
      let effectiveRoleId = userPermission.roleId;

      // For GLOBAL_ROLE, use the user's global role
      if (userPermission.accessType === ProjectAccessType.GLOBAL_ROLE) {
        effectiveRoleId = user.roleId;
      }

      return {
        userId: userId,
        accessType: userPermission.accessType,
        roleId: userPermission.roleId,
        effectiveAccessType: userPermission.accessType,
        effectiveRoleId: effectiveRoleId,
      };
    }

    // Check if user is in a group that has permissions on this project
    const groupPermission = await prisma.groupProjectPermission.findFirst({
      where: {
        projectId: projectId,
        group: {
          assignedUsers: {
            some: {
              userId: userId,
            },
          },
        },
      },
      select: {
        accessType: true,
        roleId: true,
      },
      orderBy: {
        // Prioritize more specific permissions over defaults
        accessType: "desc",
      },
    });

    if (groupPermission && groupPermission.accessType !== ProjectAccessType.NO_ACCESS) {
      let effectiveRoleId: number | null = null;

      if (groupPermission.accessType === ProjectAccessType.GLOBAL_ROLE) {
        // Use user's global role
        effectiveRoleId = user.roleId;
      } else if (groupPermission.accessType === ProjectAccessType.SPECIFIC_ROLE) {
        // Use the group's specific role
        effectiveRoleId = groupPermission.roleId;
      }

      return {
        userId: userId,
        accessType: groupPermission.accessType,
        roleId: groupPermission.roleId,
        effectiveAccessType: groupPermission.accessType,
        effectiveRoleId: effectiveRoleId,
      };
    }

    // Check if user is assigned to project (uses project default)
    const assignment = await prisma.projectAssignment.findUnique({
      where: {
        userId_projectId: {
          userId: userId,
          projectId: projectId,
        },
      },
    });

    if (assignment) {
      // User is assigned but has no explicit permission, so they use project default
      const effectiveAccessType = project.defaultAccessType;
      let effectiveRoleId: number | null = null;

      if (project.defaultAccessType === ProjectAccessType.GLOBAL_ROLE) {
        // Use user's global role
        effectiveRoleId = user.roleId;
      } else if (
        project.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE
      ) {
        // Use project's default role
        effectiveRoleId = project.defaultRoleId;
      }

      return {
        userId: userId,
        accessType: "PROJECT_DEFAULT",
        roleId: null,
        effectiveAccessType: effectiveAccessType,
        effectiveRoleId: effectiveRoleId,
      };
    }

    // User is not assigned to project
    return null;
  } catch (error) {
    console.error("Error getting user effective project access:", error);
    return null;
  }
}

export async function getBatchUserEffectiveProjectAccess(
  projectId: number,
  userIds: string[]
): Promise<Map<string, UserEffectiveAccess>> {
  const results = new Map<string, UserEffectiveAccess>();

  try {
    // Get the project with default settings
    const project = await prisma.projects.findUnique({
      where: { id: projectId },
      select: {
        defaultAccessType: true,
        defaultRoleId: true,
      },
    });

    if (!project) {
      return results;
    }

    // Get all users with their roles
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        id: true,
        roleId: true,
        access: true,
      },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    // Get all explicit user permissions for this project
    const userPermissions = await prisma.userProjectPermission.findMany({
      where: {
        userId: { in: userIds },
        projectId: projectId,
      },
      select: {
        userId: true,
        accessType: true,
        roleId: true,
      },
    });

    const permissionMap = new Map(userPermissions.map((p) => [p.userId, p]));

    // Get all group permissions for this project with their users
    const groupPermissions = await prisma.groupProjectPermission.findMany({
      where: {
        projectId: projectId,
      },
      select: {
        accessType: true,
        roleId: true,
        group: {
          select: {
            assignedUsers: {
              where: {
                userId: { in: userIds },
              },
              select: {
                userId: true,
              },
            },
          },
        },
      },
    });

    // Build a map of userId -> group permission
    const groupPermissionMap = new Map<string, { accessType: ProjectAccessType; roleId: number | null }>();
    for (const groupPerm of groupPermissions) {
      for (const assignment of groupPerm.group.assignedUsers) {
        // Only set if not already set (first group permission wins)
        if (!groupPermissionMap.has(assignment.userId)) {
          groupPermissionMap.set(assignment.userId, {
            accessType: groupPerm.accessType,
            roleId: groupPerm.roleId,
          });
        }
      }
    }

    // Get all assignments for this project
    const assignments = await prisma.projectAssignment.findMany({
      where: {
        userId: { in: userIds },
        projectId: projectId,
      },
      select: {
        userId: true,
      },
    });

    const assignmentSet = new Set(assignments.map((a) => a.userId));

    // Process each user
    for (const userId of userIds) {
      const user = userMap.get(userId);
      if (!user) continue;

      const permission = permissionMap.get(userId);
      const groupPermission = groupPermissionMap.get(userId);
      const isAssigned = assignmentSet.has(userId);

      if (permission) {
        // User has explicit permission
        let effectiveRoleId = permission.roleId;

        // For GLOBAL_ROLE, use the user's global role
        if (permission.accessType === ProjectAccessType.GLOBAL_ROLE) {
          effectiveRoleId = user.roleId;
        }

        results.set(userId, {
          userId: userId,
          accessType: permission.accessType,
          roleId: permission.roleId,
          effectiveAccessType: permission.accessType,
          effectiveRoleId: effectiveRoleId,
        });
      } else if (groupPermission && groupPermission.accessType !== ProjectAccessType.NO_ACCESS) {
        // User has group permission
        let effectiveRoleId: number | null = null;

        if (groupPermission.accessType === ProjectAccessType.GLOBAL_ROLE) {
          // Use user's global role
          effectiveRoleId = user.roleId;
        } else if (groupPermission.accessType === ProjectAccessType.SPECIFIC_ROLE) {
          // Use the group's specific role
          effectiveRoleId = groupPermission.roleId;
        }

        results.set(userId, {
          userId: userId,
          accessType: groupPermission.accessType,
          roleId: groupPermission.roleId,
          effectiveAccessType: groupPermission.accessType,
          effectiveRoleId: effectiveRoleId,
        });
      } else if (isAssigned) {
        // User is assigned but has no explicit permission, so they use project default
        const effectiveAccessType = project.defaultAccessType;
        let effectiveRoleId: number | null = null;

        if (project.defaultAccessType === ProjectAccessType.GLOBAL_ROLE) {
          // Use user's global role
          effectiveRoleId = user.roleId;
        } else if (
          project.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE
        ) {
          // Use project's default role
          effectiveRoleId = project.defaultRoleId;
        }

        results.set(userId, {
          userId: userId,
          accessType: "PROJECT_DEFAULT",
          roleId: null,
          effectiveAccessType: effectiveAccessType,
          effectiveRoleId: effectiveRoleId,
        });
      }
      // If user is not assigned to project, they are not included in results
    }

    return results;
  } catch (error) {
    console.error("Error getting batch user effective project access:", error);
    return results;
  }
}
