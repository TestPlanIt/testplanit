"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchCaseIdsByLatestStatus } from "~/app/actions/caseIdsByLatestStatus";

/**
 * Page of case ids ordered by the status of each case's most recent result.
 *
 * Returns `null` while disabled or still loading so callers can tell "not
 * sorting this way" apart from "sorted, and the page is empty".
 */
export function useCaseIdsByLatestStatus(args: {
  where: unknown;
  direction: "asc" | "desc";
  skip?: number;
  take?: number;
  enabled: boolean;
}) {
  const { where, direction, skip, take, enabled } = args;

  const { data, isFetching } = useQuery({
    queryKey: ["caseIdsByLatestStatus", where, direction, skip, take],
    queryFn: async () => {
      const result = await fetchCaseIdsByLatestStatus({
        where: where as never,
        direction,
        skip,
        take,
      });
      return result.success ? result.ids : [];
    },
    enabled,
    placeholderData: (previous) => previous,
  });

  return { pageIds: enabled ? (data ?? null) : null, isFetching };
}
