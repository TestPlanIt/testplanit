"use server";

import { sql } from "kysely";

import { baseDb } from "~/lib/db";
import { getServerAuthSession } from "~/server/auth";

export interface AuditLogProjectOption {
  id: number;
  name: string;
}

/**
 * List the distinct projects that appear in the audit log, driving the admin
 * audit-log project filter — the picker only offers projects that have rows
 * behind them.
 *
 * Postgres has no loose index scan, so a plain `DISTINCT "projectId"` reads
 * every row regardless of indexes. The recursive CTE emulates one: each step
 * seeks the next distinct project id through the `(projectId, timestamp)`
 * index, so cost scales with the number of distinct projects rather than the
 * size of the table. Names come from a join against the handful of distinct
 * ids; projects deleted since (SetNull leaves orphaned ids) drop out of the
 * join, matching the previous relation-select behavior.
 *
 * Reads cross-user audit data, so it bypasses ZenStack and is therefore
 * gated to ADMIN to match the model's `@@allow('read', access == 'ADMIN')`.
 */
export async function getAuditLogProjects(): Promise<AuditLogProjectOption[]> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return [];
  }

  try {
    const rows = (
      await sql<AuditLogProjectOption>`
      WITH RECURSIVE distinct_project AS (
        (
          SELECT "projectId"
          FROM "AuditLog"
          WHERE "projectId" IS NOT NULL
          ORDER BY "projectId"
          LIMIT 1
        )
        UNION ALL
        SELECT (
          SELECT a."projectId"
          FROM "AuditLog" a
          WHERE a."projectId" > d."projectId"
          ORDER BY a."projectId"
          LIMIT 1
        )
        FROM distinct_project d
        WHERE d."projectId" IS NOT NULL
      )
      SELECT p."id", p."name"
      FROM distinct_project d
      JOIN "Projects" p ON p."id" = d."projectId"
      ORDER BY p."name" ASC
    `.execute(baseDb.$qb)
    ).rows;

    return rows;
  } catch (error) {
    console.error("Error fetching audit log projects:", error);
    return [];
  }
}
