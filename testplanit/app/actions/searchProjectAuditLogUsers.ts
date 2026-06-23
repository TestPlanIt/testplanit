"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";
import type { AuditLogUserOption } from "./searchAuditLogUsers";

/**
 * Search and paginate the distinct actors that appear in a single project's
 * audit log, driving the project audit-log user filter.
 *
 * Like {@link searchAuditLogUsers} but scoped to one project. Reads cross-user
 * audit data, so it bypasses ZenStack and replicates the model's read policy:
 * system ADMINs, or PROJECTADMINs assigned to the project, may query it.
 *
 * @param projectId - the project to scope actors to
 * @param query - filter by actor name or email (case-insensitive)
 * @param page - zero-indexed page number
 * @param pageSize - results per page
 */
export async function searchProjectAuditLogUsers(
  projectId: number,
  query: string,
  page: number,
  pageSize: number
): Promise<{ results: AuditLogUserOption[]; total: number }> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || !Number.isInteger(projectId)) {
    return { results: [], total: 0 };
  }

  if (session.user.access !== "ADMIN") {
    if (session.user.access !== "PROJECTADMIN") {
      return { results: [], total: 0 };
    }
    const assignment = await prisma.projectAssignment.count({
      where: { userId: session.user.id, projectId },
    });
    if (assignment === 0) {
      return { results: [], total: 0 };
    }
  }

  const take = Math.min(Math.max(pageSize, 1), 100);
  const skip = Math.max(page, 0) * take;

  const trimmed = query?.trim();
  const searchClause = trimmed
    ? Prisma.sql`AND ("userName" ILIKE ${`%${trimmed}%`} OR "userEmail" ILIKE ${`%${trimmed}%`})`
    : Prisma.empty;

  try {
    const results = await prisma.$queryRaw<AuditLogUserOption[]>(Prisma.sql`
      SELECT "userId", "userName", "userEmail"
      FROM (
        SELECT DISTINCT ON ("userId") "userId", "userName", "userEmail"
        FROM "AuditLog"
        WHERE "projectId" = ${projectId} AND "userId" IS NOT NULL ${searchClause}
        ORDER BY "userId", "timestamp" DESC
      ) s
      ORDER BY "userName" ASC NULLS LAST, "userEmail" ASC NULLS LAST
      LIMIT ${take} OFFSET ${skip}
    `);

    const countRows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT "userId")::int AS count
      FROM "AuditLog"
      WHERE "projectId" = ${projectId} AND "userId" IS NOT NULL ${searchClause}
    `);

    return { results, total: countRows[0]?.count ?? 0 };
  } catch (error) {
    console.error("Error searching project audit log users:", error);
    return { results: [], total: 0 };
  }
}
