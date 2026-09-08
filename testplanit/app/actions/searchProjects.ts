"use server";

import { baseDb } from "~/lib/db";

/**
 * Search and paginate projects by name.
 *
 * @param query - Search query to filter by name
 * @param page - Page number (0-indexed)
 * @param pageSize - Number of results per page
 * @returns Paginated results with total count
 */
export async function searchProjects(
  query: string,
  page: number,
  pageSize: number
): Promise<{
  results: Array<{
    id: number;
    name: string;
    iconUrl: string | null;
  }>;
  total: number;
}> {
  try {
    const whereClause: any = {
      isDeleted: false,
    };

    if (query && query.trim().length > 0) {
      whereClause.name = { contains: query.trim(), mode: "insensitive" };
    }

    const [results, total] = await Promise.all([
      baseDb.projects.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          iconUrl: true,
        },
        skip: page * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      baseDb.projects.count({ where: whereClause }),
    ]);

    return { results, total };
  } catch (error) {
    console.error("Error searching projects:", error);
    return { results: [], total: 0 };
  }
}
