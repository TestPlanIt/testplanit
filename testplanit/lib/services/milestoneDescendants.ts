import { baseDb } from "~/lib/db";

/**
 * Returns all descendant milestone IDs for a given milestone using a
 * recursive CTE (single database round trip). `db` accepts a transaction
 * client so callers running inside a transaction (e.g. rollback-scoped
 * integration tests) see their own uncommitted rows.
 */
export async function getAllDescendantMilestoneIds(
  milestoneId: number,
  db: Pick<typeof baseDb, "$queryRaw"> = baseDb
): Promise<number[]> {
  const result = await db.$queryRaw<Array<{ id: number }>>`
    WITH RECURSIVE descendants AS (
      SELECT id FROM "Milestones"
      WHERE "parentId" = ${milestoneId} AND "isDeleted" = false
      UNION ALL
      SELECT m.id FROM "Milestones" m
      INNER JOIN descendants d ON m."parentId" = d.id
      WHERE m."isDeleted" = false
    )
    SELECT id FROM descendants
  `;
  return result.map((r) => r.id);
}
