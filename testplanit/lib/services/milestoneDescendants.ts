import { baseDb } from "~/lib/db";

/**
 * Returns all descendant milestone IDs for a given milestone using a
 * recursive CTE (single database round trip).
 */
export async function getAllDescendantMilestoneIds(
  milestoneId: number
): Promise<number[]> {
  const result = await baseDb.$queryRaw<Array<{ id: number }>>`
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
