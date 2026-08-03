import { baseDb } from "~/lib/db";
import { queryProjectRelevantIssueIds } from "~/lib/projectIssueIdsQuery";

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
 *
 * The query itself lives in lib/projectIssueIdsQuery.ts (client-safe,
 * injected db) so isomorphic modules can run it without importing the
 * server-only prisma stack.
 */
export async function getProjectRelevantIssueIds(
  projectId: number
): Promise<number[]> {
  return queryProjectRelevantIssueIds(baseDb, projectId);
}
