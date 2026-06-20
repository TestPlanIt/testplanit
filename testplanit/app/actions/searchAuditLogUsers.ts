"use server";

import { sql } from "kysely";

import { prisma } from "~/lib/prisma";
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
    const results = (
      await sql<AuditLogUserOption>`
      SELECT "userId", "userName", "userEmail"
      FROM (
        SELECT DISTINCT ON ("userId") "userId", "userName", "userEmail"
        FROM "AuditLog"
        WHERE "userId" IS NOT NULL ${searchClause}
        ORDER BY "userId", "timestamp" DESC
      ) s
      ORDER BY "userName" ASC NULLS LAST, "userEmail" ASC NULLS LAST
      LIMIT ${take} OFFSET ${skip}
    `.execute(prisma.$qb)
    ).rows;

    const countRows = (
      await sql<{ count: number }>`
      SELECT COUNT(DISTINCT "userId")::int AS count
      FROM "AuditLog"
      WHERE "userId" IS NOT NULL ${searchClause}
    `.execute(prisma.$qb)
    ).rows;

    return { results, total: countRows[0]?.count ?? 0 };
  } catch (error) {
    console.error("Error searching audit log users:", error);
    return { results: [], total: 0 };
  }
}
