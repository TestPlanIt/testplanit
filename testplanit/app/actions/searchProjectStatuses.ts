"use server";

import { baseDb } from "~/lib/db";

/**
 * Search and paginate statuses scoped to a single project's
 * `ProjectStatusAssignment` set, with prefix/contains name search.
 *
 * Used by the Matrix preset's filter panel — the matrix view only ever shows
 * iterations that come from runs in `projectId`, so the status filter must
 * not include statuses that aren't enabled for that project.
 */
export async function searchProjectStatuses(
  projectId: number,
  query: string,
  page: number,
  pageSize: number
): Promise<{
  results: Array<{ id: number; name: string; color: string }>;
  total: number;
}> {
  try {
    const whereClause: {
      isDeleted: boolean;
      isEnabled: boolean;
      projects: { some: { projectId: number } };
      name?: { contains: string; mode: "insensitive" };
    } = {
      isDeleted: false,
      isEnabled: true,
      projects: { some: { projectId } },
    };

    if (query && query.trim().length > 0) {
      whereClause.name = { contains: query.trim(), mode: "insensitive" };
    }

    const [rows, total] = await Promise.all([
      baseDb.status.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          color: { select: { value: true } },
        },
        skip: page * pageSize,
        take: pageSize,
        orderBy: { order: "asc" },
      }),
      baseDb.status.count({ where: whereClause }),
    ]);

    const results = rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color?.value ?? "#B1B2B3",
    }));

    return { results, total };
  } catch (error) {
    console.error("Error searching project statuses:", error);
    return { results: [], total: 0 };
  }
}
