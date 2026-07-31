"use server";

import { sql } from "kysely";

import { baseDb } from "~/lib/db";
import { getServerAuthSession } from "~/server/auth";

export interface AuditLogUserOption {
  userId: string;
  userName: string | null;
  userEmail: string | null;
}

/**
 * Search and paginate the distinct actors that appear in the audit log,
 * driving the admin audit-log user filter.
 *
 * One option per distinct `userId`, carrying the most recent name/email
 * snapshot for that actor (the audit log denormalizes the actor's name at
 * write time, so the same id can carry many historical snapshots). Search
 * matches any snapshot's name or email so renamed users stay findable.
 *
 * Postgres has no loose index scan, so `DISTINCT ON ("userId")` and
 * `COUNT(DISTINCT "userId")` both read every row regardless of indexes. The
 * recursive CTE emulates one instead: each step seeks the next distinct
 * `userId` through the `(userId, timestamp)` index, and a lateral per actor
 * seeks that actor's newest matching snapshot backward through the same
 * index, so cost scales with the number of distinct actors rather than the
 * size of the table. The windowed count returns the total in the same pass,
 * replacing the separate `COUNT(DISTINCT ...)` scan.
 *
 * Reads cross-user audit data, so it bypasses ZenStack and is therefore
 * gated to ADMIN to match the model's `@@allow('read', access == 'ADMIN')`.
 *
 * @param query - filter by actor name or email (case-insensitive)
 * @param page - zero-indexed page number
 * @param pageSize - results per page
 */
export async function searchAuditLogUsers(
  query: string,
  page: number,
  pageSize: number
): Promise<{ results: AuditLogUserOption[]; total: number }> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { results: [], total: 0 };
  }

  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = Math.max(page, 0) * take;

  const trimmed = query?.trim();
  const searchClause = trimmed
    ? sql`AND ("userName" ILIKE ${`%${trimmed}%`} OR "userEmail" ILIKE ${`%${trimmed}%`})`
    : sql``;

  try {
    const rows = (
      await sql<AuditLogUserOption & { total: number }>`
      WITH RECURSIVE distinct_actor AS (
        (
          SELECT "userId"
          FROM "AuditLog"
          WHERE "userId" IS NOT NULL
          ORDER BY "userId"
          LIMIT 1
        )
        UNION ALL
        SELECT (
          SELECT a."userId"
          FROM "AuditLog" a
          WHERE a."userId" > d."userId"
          ORDER BY a."userId"
          LIMIT 1
        )
        FROM distinct_actor d
        WHERE d."userId" IS NOT NULL
      ),
      actors AS (
        SELECT d."userId", snap."userName", snap."userEmail"
        FROM distinct_actor d
        CROSS JOIN LATERAL (
          SELECT "userName", "userEmail"
          FROM "AuditLog" a
          WHERE a."userId" = d."userId" ${searchClause}
          ORDER BY a."timestamp" DESC
          LIMIT 1
        ) snap
        WHERE d."userId" IS NOT NULL
      )
      SELECT "userId", "userName", "userEmail",
        (COUNT(*) OVER ())::int AS total
      FROM actors
      ORDER BY "userName" ASC NULLS LAST, "userEmail" ASC NULLS LAST
      LIMIT ${take} OFFSET ${skip}
    `.execute(baseDb.$qb)
    ).rows;

    return {
      results: rows.map(({ userId, userName, userEmail }) => ({
        userId,
        userName,
        userEmail,
      })),
      total: rows[0]?.total ?? 0,
    };
  } catch (error) {
    console.error("Error searching audit log users:", error);
    return { results: [], total: 0 };
  }
}
