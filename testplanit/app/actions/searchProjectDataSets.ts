"use server";

import { baseDb } from "~/lib/db";

/**
 * Search and paginate datasets scoped to a single project.
 *
 * Returns owner-case-bound datasets AND project-shared datasets — the matrix
 * filter accepts either; the aggregation route's dataset filter walks
 * `TestRunCaseDataSetSnapshot.sourceDataSetId` which can point at either type.
 */
export async function searchProjectDataSets(
  projectId: number,
  query: string,
  page: number,
  pageSize: number
): Promise<{
  results: Array<{
    id: number;
    name: string;
    isShared: boolean;
    ownerCaseName: string | null;
  }>;
  total: number;
}> {
  try {
    const whereClause: {
      projectId: number;
      isDeleted: boolean;
      name?: { contains: string; mode: "insensitive" };
    } = {
      projectId,
      isDeleted: false,
    };

    if (query && query.trim().length > 0) {
      whereClause.name = { contains: query.trim(), mode: "insensitive" };
    }

    const [rows, total] = await Promise.all([
      baseDb.dataSet.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          isShared: true,
          ownerCase: { select: { name: true } },
        },
        skip: page * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      baseDb.dataSet.count({ where: whereClause }),
    ]);

    const results = rows.map((r) => ({
      id: r.id,
      name: r.name,
      isShared: r.isShared,
      ownerCaseName: r.ownerCase?.name ?? null,
    }));

    return { results, total };
  } catch (error) {
    console.error("Error searching project datasets:", error);
    return { results: [], total: 0 };
  }
}
