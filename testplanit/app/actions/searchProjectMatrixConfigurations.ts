"use server";

import { prisma } from "~/lib/prisma";

/**
 * Search and paginate configurations that are actually used by the
 * Parameterized Test Iteration Matrix for `projectId`.
 *
 * Scoping mirrors `fetchConfigAxis` in `lib/matrix/matrixAggregation.ts`:
 * a configuration appears here if at least one TestRun in the project
 * contains a TestRunCase whose RepositoryCase has `hasParameters = true`.
 * Without this filter the combobox would list every Configuration in
 * the system — most of which produce empty filter results.
 *
 * The "(none)" sentinel column (configId 0) is added by the caller, not
 * here — DB rows always have a real configurationId.
 */
export async function searchProjectMatrixConfigurations(
  projectId: number,
  query: string,
  page: number,
  pageSize: number
): Promise<{
  results: Array<{ id: number; name: string }>;
  total: number;
}> {
  try {
    const trimmed = query.trim();
    const nameFilter = trimmed.length > 0 ? trimmed.toLowerCase() : null;

    const whereSql = nameFilter ? `AND LOWER(c.name) LIKE $2` : "";
    const params: Array<string | number> = [projectId];
    if (nameFilter) params.push(`%${nameFilter}%`);

    // Count distinct configurations matching the scope.
    const totalRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `
      SELECT COUNT(DISTINCT c.id)::bigint AS count
      FROM "Configurations" c
      WHERE c."isDeleted" = false
        AND c.id IN (
          SELECT DISTINCT tr."configId"
          FROM "TestRuns" tr
          INNER JOIN "TestRunCases" trc ON trc."testRunId" = tr.id
          INNER JOIN "RepositoryCases" rc ON trc."repositoryCaseId" = rc.id
          WHERE tr."projectId" = $1
            AND tr."isDeleted" = false
            AND tr."configId" IS NOT NULL
            AND trc."isDeleted" = false
            AND rc."isDeleted" = false
            AND rc."hasParameters" = true
        )
        ${whereSql}
      `,
      ...params
    );
    const total = Number(totalRows[0]?.count ?? 0n);

    const limit = pageSize;
    const offset = page * pageSize;
    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: number; name: string }>
    >(
      `
      SELECT c.id, c.name
      FROM "Configurations" c
      WHERE c."isDeleted" = false
        AND c.id IN (
          SELECT DISTINCT tr."configId"
          FROM "TestRuns" tr
          INNER JOIN "TestRunCases" trc ON trc."testRunId" = tr.id
          INNER JOIN "RepositoryCases" rc ON trc."repositoryCaseId" = rc.id
          WHERE tr."projectId" = $1
            AND tr."isDeleted" = false
            AND tr."configId" IS NOT NULL
            AND trc."isDeleted" = false
            AND rc."isDeleted" = false
            AND rc."hasParameters" = true
        )
        ${whereSql}
      ORDER BY LOWER(c.name) ASC
      LIMIT ${limit} OFFSET ${offset}
      `,
      ...params
    );

    return { results: rows, total };
  } catch (error) {
    console.error("Error searching project matrix configurations:", error);
    return { results: [], total: 0 };
  }
}
