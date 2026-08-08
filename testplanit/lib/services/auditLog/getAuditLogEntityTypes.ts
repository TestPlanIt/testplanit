import { sql } from "kysely";

import { baseDb } from "~/lib/db";
import { getServerAuthSession } from "~/server/auth";

/**
 * List the distinct entity types that appear in the audit log, driving the
 * admin audit-log entity-type filter — the picker only offers values that
 * have rows behind them.
 *
 * Postgres has no loose index scan, so a plain `DISTINCT "entityType"` reads
 * every row regardless of indexes. The recursive CTE emulates one: each step
 * seeks the next distinct entity type through the `(entityType, entityId)`
 * index, so cost scales with the number of distinct entity types rather than
 * the size of the table.
 *
 * Reads cross-user audit data, so it bypasses ZenStack and is therefore
 * gated to ADMIN to match the model's `@@allow('read', access == 'ADMIN')`.
 */
export async function getAuditLogEntityTypes(): Promise<string[]> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return [];
  }

  try {
    const rows = (
      await sql<{ entityType: string }>`
      WITH RECURSIVE distinct_entity_type AS (
        (
          SELECT "entityType"
          FROM "AuditLog"
          ORDER BY "entityType"
          LIMIT 1
        )
        UNION ALL
        SELECT (
          SELECT a."entityType"
          FROM "AuditLog" a
          WHERE a."entityType" > d."entityType"
          ORDER BY a."entityType"
          LIMIT 1
        )
        FROM distinct_entity_type d
        WHERE d."entityType" IS NOT NULL
      )
      SELECT "entityType"
      FROM distinct_entity_type
      WHERE "entityType" IS NOT NULL
    `.execute(baseDb.$qb)
    ).rows;

    return rows.map((row) => row.entityType);
  } catch (error) {
    console.error("Error fetching audit log entity types:", error);
    return [];
  }
}
