/**
 * Ids of users with user-engagement activity (cases created, manual results,
 * automated results, session results) in one project, or across all projects
 * when projectId is undefined. Driven from the activity tables: the same
 * filter written as `some` relations on User seq-scans JUnitTestResult once
 * per user. Must stay free of server-only imports (see
 * lib/projectIssueIdsQuery.ts).
 */
export async function queryEngagementUserIds(
  db: { $queryRaw: (...args: any[]) => Promise<any> },
  projectId: number | undefined
): Promise<string[]> {
  const rows = (
    projectId !== undefined
      ? await db.$queryRaw`
          SELECT rc."creatorId" AS id FROM "RepositoryCases" rc
            WHERE rc."projectId" = ${projectId} AND rc."isDeleted" = false
          UNION
          SELECT rr."executedById" AS id FROM "TestRunResults" rr
            JOIN "TestRuns" r ON r."id" = rr."testRunId"
            WHERE rr."isDeleted" = false
              AND r."projectId" = ${projectId} AND r."isDeleted" = false
          UNION
          SELECT jr."createdById" AS id FROM "JUnitTestResult" jr
            JOIN "JUnitTestSuite" js ON js."id" = jr."testSuiteId"
            JOIN "TestRuns" r ON r."id" = js."testRunId"
            WHERE r."projectId" = ${projectId} AND r."isDeleted" = false
          UNION
          SELECT sr."createdById" AS id FROM "SessionResults" sr
            JOIN "Sessions" s ON s."id" = sr."sessionId"
            WHERE sr."isDeleted" = false
              AND s."projectId" = ${projectId} AND s."isDeleted" = false
        `
      : await db.$queryRaw`
          SELECT rc."creatorId" AS id FROM "RepositoryCases" rc
            WHERE rc."isDeleted" = false
          UNION
          SELECT rr."executedById" AS id FROM "TestRunResults" rr
            JOIN "TestRuns" r ON r."id" = rr."testRunId"
            WHERE rr."isDeleted" = false AND r."isDeleted" = false
          UNION
          SELECT jr."createdById" AS id FROM "JUnitTestResult" jr
            JOIN "JUnitTestSuite" js ON js."id" = jr."testSuiteId"
            JOIN "TestRuns" r ON r."id" = js."testRunId"
            WHERE r."isDeleted" = false
          UNION
          SELECT sr."createdById" AS id FROM "SessionResults" sr
            JOIN "Sessions" s ON s."id" = sr."sessionId"
            WHERE sr."isDeleted" = false AND s."isDeleted" = false
        `
  ) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
