"use server";

import { getProjectEffectiveMembers } from "./getProjectEffectiveMembers";
import { prisma } from "~/lib/prisma";

/**
 * Search and paginate users who have access to a project.
 * Uses getProjectEffectiveMembers to ensure all users with implicit access are included.
 *
 * @param projectId - The project ID
 * @param query - Search query to filter users by name or email
 * @param page - Page number (0-indexed)
 * @param pageSize - Number of results per page
 * @returns Paginated results with total count
 */
export async function searchProjectMembers(
  projectId: number,
  query: string,
  page: number,
  pageSize: number
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
    const effectiveMemberIds = await getProjectEffectiveMembers(projectId);

    if (effectiveMemberIds.length === 0) {
      return { results: [], total: 0 };
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
    const users = await prisma.user.findMany({
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
    const total = await prisma.user.count({
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
