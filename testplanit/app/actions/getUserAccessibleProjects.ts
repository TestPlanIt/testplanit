"use server";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function getUserAccessibleProjects(userId: string) {
  try {
    // Get the user with their role and groups
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        groups: {
          include: {
            group: {
              include: {
                projectPermissions: {
                  where: {
                    project: {
                      isDeleted: false,
                    },
                  },
                  include: {
                    project: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return [];
    }

    // If user has NONE system access, they cannot access ANY projects
    if (user.access === "NONE") {
      return [];
    }

    // If user has ADMIN access, return all projects
    if (user.access === "ADMIN") {
      const allProjects = await prisma.projects.findMany({
        where: { isDeleted: false },
        select: { id: true },
      });
      return allProjects.map(p => ({ projectId: p.id }));
    }

    const projectIds = new Set<number>();

    // 1. Projects user created
    const createdProjects = await prisma.projects.findMany({
      where: {
        createdBy: userId,
        isDeleted: false,
      },
      select: { id: true },
    });
    createdProjects.forEach(p => projectIds.add(p.id));

    // 2. Projects with explicit user permissions (not NO_ACCESS)
    const userPermissions = await prisma.userProjectPermission.findMany({
      where: {
        userId: userId,
        accessType: {
          not: "NO_ACCESS",
        },
        project: {
          isDeleted: false,
        },
      },
      select: { projectId: true },
    });
    userPermissions.forEach(p => projectIds.add(p.projectId));

    // 3. Projects user is explicitly assigned to
    const assignments = await prisma.projectAssignment.findMany({
      where: {
        userId: userId,
        project: {
          isDeleted: false,
        },
      },
      select: { projectId: true },
    });
    assignments.forEach(p => projectIds.add(p.projectId));

    // 4. Projects accessible through groups (if user doesn't have explicit NO_ACCESS)
    const groupProjectIds = new Set<number>();
    for (const userGroup of user.groups) {
      for (const groupPerm of userGroup.group.projectPermissions) {
        if (groupPerm.accessType !== "NO_ACCESS" && groupPerm.project && !groupPerm.project.isDeleted) {
          groupProjectIds.add(groupPerm.projectId);
        }
      }
    }

    // Check if user has explicit NO_ACCESS that overrides group permissions
    const explicitDenials = await prisma.userProjectPermission.findMany({
      where: {
        userId: userId,
        accessType: "NO_ACCESS",
      },
      select: { projectId: true },
    });
    const deniedProjectIds = new Set(explicitDenials.map(d => d.projectId));

    // Add group projects that aren't explicitly denied
    groupProjectIds.forEach(id => {
      if (!deniedProjectIds.has(id)) {
        projectIds.add(id);
      }
    });

    // 5. Projects with GLOBAL_ROLE default (uses user's global role)
    if (user.roleId) {
      const globalRoleProjects = await prisma.projects.findMany({
        where: {
          defaultAccessType: "GLOBAL_ROLE",
          isDeleted: false,
        },
        select: { id: true },
      });
      
      // Only add if not explicitly denied
      globalRoleProjects.forEach(p => {
        if (!deniedProjectIds.has(p.id)) {
          projectIds.add(p.id);
        }
      });
    }

    // 6. Projects with SPECIFIC_ROLE default (uses project's default role)
    const specificRoleProjects = await prisma.projects.findMany({
      where: {
        defaultAccessType: "SPECIFIC_ROLE",
        defaultRoleId: {
          not: null,
        },
        isDeleted: false,
      },
      select: { id: true },
    });
    
    // Only add if not explicitly denied
    specificRoleProjects.forEach(p => {
      if (!deniedProjectIds.has(p.id)) {
        projectIds.add(p.id);
      }
    });

    // 7. Projects with DEFAULT access type (legacy - everyone has access)
    const defaultProjects = await prisma.projects.findMany({
      where: {
        defaultAccessType: "DEFAULT",
        isDeleted: false,
      },
      select: { id: true },
    });
    
    // DEFAULT means everyone has access unless explicitly denied
    defaultProjects.forEach(p => {
      if (!deniedProjectIds.has(p.id)) {
        projectIds.add(p.id);
      }
    });

    // NOTE: Projects with defaultAccessType = 'NO_ACCESS' are NOT added here
    // They require explicit permissions via user permissions, assignments, or groups
    // which are already handled above

    return Array.from(projectIds).map(id => ({ projectId: id }));
  } catch (error) {
    console.error("Error getting user accessible projects:", error);
    return [];
  }
}