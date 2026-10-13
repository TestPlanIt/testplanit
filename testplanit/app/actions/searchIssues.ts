"use server";

import { getEnhancedDb } from "~/lib/auth/utils";
import { DEFECT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { getServerAuthSession } from "~/server/auth";

export interface IssueSearchOption {
  id: number;
  name: string;
  title: string;
  externalKey: string | null;
}

/**
 * Search and paginate issues for a picker, matching on the issue name, title,
 * or external key.
 *
 * Unlike the other filter sources in unified search — which load their whole
 * (small) option list up front — issues can run into the tens of thousands, so
 * this pages against the database. Runs on the enhanced client, so the caller
 * only ever sees issues their project access allows.
 */
export async function searchIssues(
  query: string,
  page: number,
  pageSize: number,
  projectId?: number
): Promise<{ results: IssueSearchOption[]; total: number }> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { results: [], total: 0 };
  }

  try {
    const db = await getEnhancedDb(session);

    const term = query.trim();
    const where: any = {
      isDeleted: false,
      ...DEFECT_SCOPE_WHERE,
      ...(projectId ? { projectId } : {}),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { title: { contains: term, mode: "insensitive" } },
              { externalKey: { contains: term, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [results, total] = await Promise.all([
      db.issue.findMany({
        where,
        select: { id: true, name: true, title: true, externalKey: true },
        skip: page * pageSize,
        take: pageSize,
        orderBy: { name: "asc" },
      }),
      db.issue.count({ where }),
    ]);

    return { results, total };
  } catch (error) {
    console.error("Error searching issues:", error);
    return { results: [], total: 0 };
  }
}
