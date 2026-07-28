"use server";

import { getEnhancedDb } from "~/lib/auth/utils";
import { sortCaseIdsByFieldOptionOrder } from "~/lib/services/caseFieldOptionSort";
import { getServerAuthSession } from "~/server/auth";
import type { RepositoryCasesWhereInput } from "~/zenstack/input";

/**
 * The ids for one page of cases, ordered by the selected option of one
 * Dropdown custom field. Options compare by their admin-defined
 * FieldOptions.order; cases without a selection sort last.
 *
 * ZenStack cannot order by this: the selected option id lives inside the
 * CaseFieldValues Json value, so no orderBy can reach the option's order
 * column. As with the latest-results sort, the filtered set is resolved to
 * ids through the normal policy-checked query, ordered here, and only the
 * resulting page is hydrated by the caller.
 */
export async function fetchCaseIdsByFieldOption(args: {
  where: RepositoryCasesWhereInput;
  fieldId: number;
  direction: "asc" | "desc";
  skip?: number;
  take?: number;
}) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false as const, error: "Unauthorized", ids: [] };
  }
  if (!Number.isInteger(args.fieldId) || args.fieldId <= 0) {
    return { success: false as const, error: "Invalid field", ids: [] };
  }

  try {
    const db = await getEnhancedDb(session);
    const rows = await db.repositoryCases.findMany({
      where: args.where,
      select: { id: true },
    });
    const caseIds = rows.map((r: { id: number }) => r.id);

    const values = await db.caseFieldValues.findMany({
      where: { fieldId: args.fieldId, testCaseId: { in: caseIds } },
      select: { testCaseId: true, value: true },
    });
    const options = await db.fieldOptions.findMany({
      where: { caseFields: { some: { caseFieldId: args.fieldId } } },
      select: { id: true, order: true, name: true },
    });

    const ordered = sortCaseIdsByFieldOptionOrder(
      caseIds,
      values,
      options,
      args.direction
    );

    const skip = args.skip ?? 0;
    const ids =
      args.take === undefined
        ? ordered.slice(skip)
        : ordered.slice(skip, skip + args.take);

    return { success: true as const, ids };
  } catch (error) {
    console.error("Error ordering cases by field option:", error);
    return { success: false as const, error: "Failed to order cases", ids: [] };
  }
}
