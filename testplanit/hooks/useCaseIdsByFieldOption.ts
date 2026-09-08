"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchCaseIdsByFieldOption } from "~/app/actions/caseIdsByFieldOption";
import { serializeWhereForTransport } from "~/lib/repository/whereTransport";

/**
 * Page of case ids ordered by one Dropdown custom field's selected option,
 * following the admin-defined option order.
 *
 * Returns `null` while disabled or still loading so callers can tell "not
 * sorting this way" apart from "sorted, and the page is empty".
 */
export function useCaseIdsByFieldOption(args: {
  where: unknown;
  fieldId: number;
  direction: "asc" | "desc";
  skip?: number;
  take?: number;
  enabled: boolean;
}) {
  const { where, fieldId, direction, skip, take, enabled } = args;

  const { data, isFetching } = useQuery({
    queryKey: ["caseIdsByFieldOption", where, fieldId, direction, skip, take],
    queryFn: async () => {
      const result = await fetchCaseIdsByFieldOption({
        // React Flight cannot encode the where's Json-null sentinels; they
        // travel in their plain form and the action rebuilds them.
        where: serializeWhereForTransport(where) as never,
        fieldId,
        direction,
        skip,
        take,
      });
      // Throw rather than return [] — the caller reads an empty array as "the
      // sorted page is genuinely empty" and skips its fetch entirely, so an
      // error surfaced as [] would stick the table on "No test cases".
      if (!result.success) throw new Error(result.error);
      return result.ids;
    },
    enabled,
    // No placeholderData: the caller merges these ids INTO its where clause,
    // so ids must never outlive the where they were computed for. Serving the
    // previous filter's page while a folder switch is in flight intersects the
    // new folder with the old folder's ids and rows silently vanish. A null
    // during the fetch makes the caller fall back to an unsorted fetch of the
    // correct rows instead.
  });

  return { pageIds: enabled ? (data ?? null) : null, isFetching };
}
