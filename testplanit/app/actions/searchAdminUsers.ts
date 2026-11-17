"use server";

import { baseDb } from "~/lib/db";
import { getServerAuthSession } from "~/server/auth";

/**
 * Search and paginate the active system administrators: the only people a
 * system alert (one with no project, such as an AI budget alert) can reach.
 * Only an administrator may ask, since only administrators manage those
 * alerts.
 */
export async function searchAdminUsers(
  query: string,
  page: number,
  pageSize: number
): Promise<{
  results: Array<{
    id: string;
    name: string;
    email: string | null;
    image: string | null;
  }>;
  total: number;
}> {
  const session = await getServerAuthSession();
  if (session?.user?.access !== "ADMIN") return { results: [], total: 0 };

  const where: Record<string, unknown> = {
    access: "ADMIN",
    isActive: true,
    isDeleted: false,
  };
  const needle = query.trim();
  if (needle.length > 0) {
    where.OR = [
      { name: { contains: needle, mode: "insensitive" } },
      { email: { contains: needle, mode: "insensitive" } },
    ];
  }

  try {
    const [results, total] = await Promise.all([
      baseDb.user.findMany({
        where,
        select: { id: true, name: true, email: true, image: true },
        skip: page * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      baseDb.user.count({ where }),
    ]);
    return { results, total };
  } catch (error) {
    console.error("Error searching administrators:", error);
    return { results: [], total: 0 };
  }
}
