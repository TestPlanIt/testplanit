import { sql } from "kysely";

import { baseDb } from "~/lib/db";
import { getServerAuthSession } from "~/server/auth";
import type { AuditAction } from "~/zenstack/models";

/**
 * List the distinct actions that actually appear in the audit log, driving
 * the admin audit-log action filter — the picker only offers values that
 * have rows behind them.
 *
 * Postgres has no loose index scan, so a plain `DISTINCT "action"` reads
 * every row regardless of the `(action)` index. The recursive CTE emulates
 * one: each step seeks the next distinct action through that index, so cost
 * scales with the number of distinct actions rather than the size of the
 * table. Results are sorted alphabetically to match the picker's display
 * order.
 *
 * Reads cross-user audit data, so it bypasses ZenStack and is therefore
 * gated to ADMIN to match the model's `@@allow('read', access == 'ADMIN')`.
 */
export async function getAuditLogActions(): Promise<AuditAction[]> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return [];
  }

  try {
    const rows = (
      await sql<{ action: AuditAction }>`
      WITH RECURSIVE distinct_action AS (
        (
          SELECT "action"
          FROM "AuditLog"
          ORDER BY "action"
          LIMIT 1
        )
        UNION ALL
        SELECT (
          SELECT a."action"
          FROM "AuditLog" a
          WHERE a."action" > d."action"
          ORDER BY a."action"
          LIMIT 1
        )
        FROM distinct_action d
        WHERE d."action" IS NOT NULL
      )
      SELECT "action"
      FROM distinct_action
      WHERE "action" IS NOT NULL
    `.execute(baseDb.$qb)
    ).rows;

    return rows.map((row) => row.action).sort();
  } catch (error) {
    console.error("Error fetching audit log actions:", error);
    return [];
  }
}
