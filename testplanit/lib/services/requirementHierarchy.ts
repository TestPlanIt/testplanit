import { baseDb } from "~/lib/db";

/**
 * Builds an issueId -> [self, ...ancestors] map for a project, used to walk
 * a requirement root-ward (e.g. to roll a descendant up into its ancestor
 * chain). A single round trip; the chain is walked in memory with a `seen`
 * guard against cycles. Unlike `buildFolderAncestorMap`, this is always
 * project-scoped — requirement trees never span projects, and cross-project
 * sharing is exactly what `assertSameProject` below exists to prevent.
 */
export async function buildIssueAncestorMap(
  db: any,
  projectId: number
): Promise<Map<number, number[]>> {
  const issues: Array<{ id: number; parentId: number | null }> =
    await db.issue.findMany({
      where: { projectId, isDeleted: false },
      select: { id: true, parentId: true },
    });

  const parentOf = new Map<number, number | null>();
  for (const issue of issues) {
    parentOf.set(issue.id, issue.parentId);
  }

  const ancestorsOf = new Map<number, number[]>();
  for (const issue of issues) {
    const chain: number[] = [];
    const seen = new Set<number>();
    let current: number | null = issue.id;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      current = parentOf.get(current) ?? null;
    }
    ancestorsOf.set(issue.id, chain);
  }

  return ancestorsOf;
}

/**
 * Returns every live descendant of `rootId`, excluding the root itself —
 * callers that need root-plus-descendants (e.g. the plan 21-06 delete path)
 * must add the root back. The `projectId` predicate is repeated in the
 * recursive arm (not just the anchor) so a cross-project `parentId` can
 * never widen the walk. `depth < 100` caps the recursion because an
 * unguarded recursive CTE over cyclic data hangs or exhausts memory rather
 * than erroring, and this phase introduces the first authoritative cycle
 * guard on any self-referential model in this schema — pre-trigger or
 * rolled-back-trigger data must fail fast.
 */
export async function getIssueSubtreeIds(
  rootId: number,
  projectId: number,
  db: Pick<typeof baseDb, "$queryRaw"> = baseDb
): Promise<number[]> {
  const rows: Array<{ id: number }> = await db.$queryRaw`
    WITH RECURSIVE descendants AS (
      SELECT id, 1 AS depth FROM "Issue"
      WHERE "parentId" = ${rootId} AND "projectId" = ${projectId} AND "isDeleted" = false
      UNION ALL
      SELECT i.id, d.depth + 1 FROM "Issue" i
      INNER JOIN descendants d ON i."parentId" = d.id
      WHERE i."projectId" = ${projectId} AND i."isDeleted" = false AND d.depth < 100
    )
    SELECT id FROM descendants
  `;
  return rows.map((row) => row.id);
}
