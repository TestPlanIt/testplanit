/**
 * The raw union query behind `getProjectRelevantIssueIds`, parameterized on
 * the database client. Isomorphic modules (utils/reportUtils is bundled into
 * client components) call this with the db they were handed instead of
 * importing the server-only prisma stack — this module must stay free of
 * server-only imports.
 *
 * See lib/projectIssueIds.ts for the semantics and the reasoning behind the
 * join-table-driven union.
 */
export async function queryProjectRelevantIssueIds(
  db: { $queryRaw: (...args: any[]) => Promise<any> },
  projectId: number
): Promise<number[]> {
  const rows = (await db.$queryRaw`
    SELECT i."id" AS id FROM "Issue" i
      WHERE i."isDeleted" = false AND i."projectId" = ${projectId}
    UNION
    SELECT ci."issueId" AS id FROM "RepositoryCaseIssue" ci
      JOIN "RepositoryCases" rc ON rc."id" = ci."caseId"
      WHERE rc."projectId" = ${projectId} AND rc."isDeleted" = false
    UNION
    SELECT j."A" AS id FROM "_IssueToSessions" j
      JOIN "Sessions" s ON s."id" = j."B"
      WHERE s."projectId" = ${projectId} AND s."isDeleted" = false
    UNION
    SELECT j."A" AS id FROM "_IssueToSessionResults" j
      JOIN "SessionResults" sr ON sr."id" = j."B"
      JOIN "Sessions" s ON s."id" = sr."sessionId"
      WHERE s."projectId" = ${projectId} AND s."isDeleted" = false
    UNION
    SELECT j."A" AS id FROM "_IssueToTestRuns" j
      JOIN "TestRuns" r ON r."id" = j."B"
      WHERE r."projectId" = ${projectId} AND r."isDeleted" = false
    UNION
    SELECT j."A" AS id FROM "_IssueToTestRunResults" j
      JOIN "TestRunResults" rr ON rr."id" = j."B"
      JOIN "TestRuns" r ON r."id" = rr."testRunId"
      WHERE r."projectId" = ${projectId} AND r."isDeleted" = false
    UNION
    SELECT j."A" AS id FROM "_IssueToTestRunStepResults" j
      JOIN "TestRunStepResults" trsr ON trsr."id" = j."B"
      JOIN "TestRunResults" rr ON rr."id" = trsr."testRunResultId"
      JOIN "TestRuns" r ON r."id" = rr."testRunId"
      WHERE r."projectId" = ${projectId} AND r."isDeleted" = false
  `) as Array<{ id: number }>;
  return rows.map((r) => Number(r.id));
}
