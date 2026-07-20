"use server";

import { getEnhancedDb } from "~/lib/auth/utils";
import { orderCaseIdsByLatestStatus } from "~/lib/services/latestTestResults";
import { getServerAuthSession } from "~/server/auth";
import type { RepositoryCasesWhereInput } from "~/zenstack/input";

/**
 * The ids for one page of cases, ordered by the status of each case's most
 * recent result.
 *
 * ZenStack cannot order by this: the value comes from a window function over
 * two result tables. Rather than rebuild the case filters in raw SQL, the
 * filtered set is resolved to ids through the normal policy-checked query,
 * ordered here, and only the resulting page is hydrated by the caller.
 *
 * Ids only — the heavy select stays with the caller's existing query, so the
 * work here is proportional to the filtered id set rather than to the fully
 * hydrated rows.
 */
export async function fetchCaseIdsByLatestStatus(args: {
  where: RepositoryCasesWhereInput;
  direction: "asc" | "desc";
  skip?: number;
  take?: number;
}) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false as const, error: "Unauthorized", ids: [] };
  }

  try {
    const db = await getEnhancedDb(session);
    const rows = await db.repositoryCases.findMany({
      where: args.where,
      select: { id: true },
    });

    const ordered = await orderCaseIdsByLatestStatus(
      rows.map((r: { id: number }) => r.id),
      args.direction
    );

    const skip = args.skip ?? 0;
    const ids =
      args.take === undefined
        ? ordered.slice(skip)
        : ordered.slice(skip, skip + args.take);

    return { success: true as const, ids };
  } catch (error) {
    console.error("Error ordering cases by latest status:", error);
    return { success: false as const, error: "Failed to order cases", ids: [] };
  }
}
