"use server";

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  ApplicationArea,
  ProjectAccessType,
  Roles,
} from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { prisma } from "~/lib/prisma";

// Define the input schema using Zod
const PermissionCheckSchema = z.object({
  userId: z.string().min(1),
  projectId: z.int().positive(),
  area: z.nativeEnum(ApplicationArea).optional(),
  checkAccessOnly: z.boolean().optional(), // New flag to only check if user has project access
});

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
): { canAddEdit: boolean; canDelete: boolean; canClose: boolean } {
  const defaultPerms = { canAddEdit: false, canDelete: false, canClose: false };
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

export async function POST(request: Request) {
  // Optional: Check if the *caller* is authenticated/authorized to make this request
  // const session = await getServerSession(authOptions);
  // if (!session) {
  //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // }
  // Add further checks if needed (e.g., caller must be admin or related to the project)

  let data;
  try {
    data = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validationResult = PermissionCheckSchema.safeParse(data);

  if (!validationResult.success) {
    return NextResponse.json(
      {
        error: "Invalid input",
        details: z.treeifyError(validationResult.error),
      },
      { status: 400 }
    );
  }

  const { userId, projectId, area, checkAccessOnly } = validationResult.data;

  try {
    // 1. Fetch all necessary data in parallel (or sequentially if dependencies exist)
    const userPromise = prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { rolePermissions: true } }, // Include global role and its permissions
        groups: { select: { groupId: true } }, // Get IDs of groups user belongs to
      },
    });

    const projectPromise = prisma.projects.findUnique({
      where: { id: projectId },
      include: {
        defaultRole: { include: { rolePermissions: true } }, // Include project default role and permissions
      },
    });

    const userProjectPermissionPromise =
      prisma.userProjectPermission.findUnique({
        where: { userId_projectId: { userId, projectId } },
        include: {
          role: { include: { rolePermissions: true } }, // Include specific role if assigned
        },
      });

    const [user, project, userProjectPermission] = await Promise.all([
      userPromise,
      projectPromise,
      userProjectPermissionPromise,
    ]);

    // --- Basic Checks ---
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let effectiveRole: RoleWithPermissions | null | undefined = null;
    let finalPermissions = {
      canAddEdit: false,
      canDelete: false,
      canClose: false,
    };
    let accessDenied = false;

    // Check if user is a System ADMIN or PROJECTADMIN
    // System ADMINs have full permissions on all projects
    // System PROJECTADMINs have full permissions on all accessible projects
    const userAccess = (user as any).access;
    const isSystemAdmin = userAccess === "ADMIN";
    const isSystemProjectAdmin = userAccess === "PROJECTADMIN";

    // 2. Determine Effective Role based on precedence

    // --- User Specific Permission ---
    if (userProjectPermission) {
      switch (userProjectPermission.accessType) {
        case ProjectAccessType.NO_ACCESS:
          accessDenied = true;
          break;
        case ProjectAccessType.GLOBAL_ROLE:
          effectiveRole = user.role as RoleWithPermissions | null;
          break;
        case ProjectAccessType.SPECIFIC_ROLE:
          // userProjectPermission includes the role with permissions
          effectiveRole =
            userProjectPermission.role as RoleWithPermissions | null;
          break;
        case ProjectAccessType.DEFAULT:
          // Defer to groups/project defaults
          break;
      }
    }

    // --- Group Permissions (if not decided by user-specific) ---
    if (!accessDenied && !effectiveRole && user.groups.length > 0) {
      const groupIds = user.groups.map((g) => g.groupId);
      const groupPermissions = await prisma.groupProjectPermission.findMany({
        where: {
          projectId: projectId,
          groupId: { in: groupIds },
          accessType: { not: ProjectAccessType.DEFAULT }, // Ignore default, look for specific denial/grant
        },
        include: {
          role: { include: { rolePermissions: true } }, // Include role for SPECIFIC_ROLE
        },
        orderBy: {
          // Define precedence if needed (e.g., NO_ACCESS first, then SPECIFIC_ROLE?)
          // For now, find the first specific role or denial
          accessType: "asc", // Process NO_ACCESS first if it exists
        },
      });

      const specificRolePermission = groupPermissions.find(
        (p) => p.accessType === ProjectAccessType.SPECIFIC_ROLE
      );
      const noAccessPermission = groupPermissions.find(
        (p) => p.accessType === ProjectAccessType.NO_ACCESS
      );

      if (noAccessPermission) {
        // Requirement: If *any* group denies access, does it override others?
        // Assuming for now it does NOT necessarily deny if another path grants.
        // If denial *should* override, set accessDenied = true here.
      }

      if (specificRolePermission) {
        effectiveRole =
          specificRolePermission.role as RoleWithPermissions | null;
      }
      // If only DEFAULT permissions found in groups, we defer to project default anyway.
    }

    // --- Project Default Permissions (if not decided yet) ---
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

    // 3. Get Permissions from Effective Role
    let resultData: any; // Use 'any' temporarily, or define a more specific union type

    // System ADMINs always have full permissions
    // System PROJECTADMINs have full permissions on projects they can access
    if (isSystemAdmin || (isSystemProjectAdmin && !accessDenied)) {
      if (area) {
        // Return full permissions for the specific area
        resultData = { canAddEdit: true, canDelete: true, canClose: true };
      } else {
        // Return full permissions for all areas
        const allPermissions: Record<
          string,
          { canAddEdit: boolean; canDelete: boolean; canClose: boolean }
        > = {};
        for (const enumArea of Object.values(ApplicationArea)) {
          allPermissions[enumArea] = {
            canAddEdit: true,
            canDelete: true,
            canClose: true,
          };
        }
        resultData = allPermissions;
      }
    } else if (!accessDenied && effectiveRole) {
      if (area) {
        // Area provided: Return permissions for the specific area
        finalPermissions = getPermissionsForArea(effectiveRole, area);
        // Final permissions for area determined
        resultData = finalPermissions;
      } else {
        // Area not provided: Return permissions for all areas
        const allPermissions: Record<
          string,
          { canAddEdit: boolean; canDelete: boolean; canClose: boolean }
        > = {};
        for (const enumArea of Object.values(ApplicationArea)) {
          allPermissions[enumArea] = getPermissionsForArea(
            effectiveRole,
            enumArea
          );
        }
        resultData = allPermissions;
      }
    } else {
      // Access denied or no effective role
      if (area) {
        // Return all false for the specific area
        resultData = { canAddEdit: false, canDelete: false, canClose: false };
      } else {
        // Return all false for all areas
        const allPermissions: Record<
          string,
          { canAddEdit: boolean; canDelete: boolean; canClose: boolean }
        > = {};
        for (const enumArea of Object.values(ApplicationArea)) {
          allPermissions[enumArea] = {
            canAddEdit: false,
            canDelete: false,
            canClose: false,
          };
        }
        resultData = allPermissions;
      }
    }

    // 4. Return Result
    // If checkAccessOnly is true, just return whether the user has access
    if (checkAccessOnly) {
      return NextResponse.json({
        hasAccess: isSystemAdmin || isSystemProjectAdmin || (!accessDenied && effectiveRole !== null),
        effectiveRole: isSystemAdmin ? "System Admin" : isSystemProjectAdmin ? "System Project Admin" : effectiveRole?.name || null,
        accessType: isSystemAdmin 
          ? "SYSTEM_ADMIN"
          : isSystemProjectAdmin
            ? "SYSTEM_PROJECTADMIN"
            : userProjectPermission?.accessType ||
          (project.defaultAccessType === ProjectAccessType.GLOBAL_ROLE
            ? "GLOBAL_ROLE"
            : project.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE
              ? "SPECIFIC_ROLE"
              : "NO_ACCESS"),
      });
    }

    // Otherwise return the detailed permissions
    return NextResponse.json({
      hasAccess: isSystemAdmin || isSystemProjectAdmin || (!accessDenied && effectiveRole !== null),
      effectiveRole: isSystemAdmin ? "System Admin" : isSystemProjectAdmin ? "System Project Admin" : effectiveRole?.name || null,
      permissions: resultData,
    });
  } catch (error) {
    console.error("Error fetching permissions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
