"use server";

import { ApplicationArea } from "~/zenstack/models";
import { baseDb } from "~/lib/db";
import { resolveEffectiveProjectRolesForUsers } from "~/lib/services/effectiveRole";
import { getProjectEffectiveMembers } from "./getProjectEffectiveMembers";

/**
 * Search and paginate users who have access to a project.
 * Uses getProjectEffectiveMembers to ensure all users with implicit access are included.
 *
 * @param projectId - The project ID
 * @param query - Search query to filter users by name or email
 * @param page - Page number (0-indexed)
 * @param pageSize - Number of results per page
 * @param options - Optional refinement; when `requireCanApproveOn` is set
 *   the candidate list is narrowed to users whose effective project role
 *   has `canApprove: true` on the given ApplicationArea.
 * @returns Paginated results with total count
 */
export async function searchProjectMembers(
  projectId: number,
  query: string,
  page: number,
  pageSize: number,
  options?: { requireCanApproveOn?: ApplicationArea }
): Promise<{
  results: Array<{
    id: string;
    name: string;
    email: string | null;
    image: string | null;
  }>;
  total: number;
}> {
  try {
    // Get all user IDs with effective access to the project
    let effectiveMemberIds = await getProjectEffectiveMembers(projectId);

    if (effectiveMemberIds.length === 0) {
      return { results: [], total: 0 };
    }

    // Optional per-user canApprove filter. Pre-compute eligible roleIds for
    // the requested area, resolve each candidate's effective project role,
    // then intersect. Short-circuit when no role at all has the permission.
    if (options?.requireCanApproveOn) {
      const eligibleRoleRows = await baseDb.rolePermission.findMany({
        where: {
          area: options.requireCanApproveOn,
          canApprove: true,
        },
        select: { roleId: true },
      });
      const eligibleRoleIds = new Set(eligibleRoleRows.map((r) => r.roleId));
      if (eligibleRoleIds.size === 0) return { results: [], total: 0 };

      const effectiveRoleByUser = await resolveEffectiveProjectRolesForUsers(
        effectiveMemberIds,
        projectId,
        baseDb
      );
      effectiveMemberIds = effectiveMemberIds.filter((uid) => {
        const rid = effectiveRoleByUser.get(uid);
        return rid !== null && rid !== undefined && eligibleRoleIds.has(rid);
      });
      if (effectiveMemberIds.length === 0) return { results: [], total: 0 };
    }

    // Build where clause for search
    const whereClause: any = {
      id: { in: effectiveMemberIds },
      isDeleted: false,
    };

    // Add search filter if query is provided
    if (query && query.trim().length > 0) {
      whereClause.OR = [
        { name: { contains: query.trim(), mode: "insensitive" } },
        { email: { contains: query.trim(), mode: "insensitive" } },
      ];
    }

    // Fetch paginated users
    const users = await baseDb.user.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
      skip: page * pageSize,
      take: pageSize,
      orderBy: { name: "asc" },
    });

    // Get total count for pagination
    const total = await baseDb.user.count({
      where: whereClause,
    });

    return {
      results: users,
      total,
    };
  } catch (error) {
    console.error("Error searching project members:", error);
    return { results: [], total: 0 };
  }
}
