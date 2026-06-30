import { baseDb } from "~/lib/db";

/**
 * Returns the IDs of issues relevant to a project: filed under the project
 * directly, or linked to any of its repository cases, sessions, session
 * results, test runs, test run results, or test run step results.
 *
 * This is driven from the small issue<->entity join tables (a few thousand
 * rows total) and joined up to the parent entity to filter by project, rather
 * than filtering the large entity tables by `{ relation: { some: { id } } }`.
 * Under ZenStack v3 the latter compiles to a correlated EXISTS subquery that
 * scans the large tables — ~1.1 s per query on production-scale data, vs ~3 ms
 * for this union. Callers then re-query issues by `id: { in: ids }` (which
 * still applies access policies), or filter further as needed.
 */
export async function getProjectRelevantIssueIds(
  projectId: number
): Promise<number[]> {
  const rows = await baseDb.$queryRaw<Array<{ id: number }>>`
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
  `;
  return rows.map((r) => Number(r.id));
}
