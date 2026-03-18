"use server";

import { prisma } from "~/lib/prisma";

/**
 * Search and paginate configurations.
 *
 * @param query - Search query to filter by name
 * @param page - Page number (0-indexed)
 * @param pageSize - Number of results per page
 * @returns Paginated results with total count
 */
export async function searchConfigurations(
  query: string,
  page: number,
  pageSize: number
): Promise<{
  results: Array<{
    id: number;
    name: string;
  }>;
  total: number;
}> {
  try {
    const whereClause: any = {
      isDeleted: false,
      isEnabled: true,
    };

    if (query && query.trim().length > 0) {
      whereClause.name = { contains: query.trim(), mode: "insensitive" };
    }

    const [results, total] = await Promise.all([
      prisma.configurations.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
        },
        skip: page * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      prisma.configurations.count({ where: whereClause }),
    ]);

    return { results, total };
  } catch (error) {
    console.error("Error searching configurations:", error);
    return { results: [], total: 0 };
  }
}
