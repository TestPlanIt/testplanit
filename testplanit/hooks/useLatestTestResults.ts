"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchLatestTestResults } from "~/app/actions/latestTestResults";
import {
  LATEST_RESULTS_COUNT,
  type TestResultExecution,
} from "~/lib/types/latestTestResults";

/**
 * Recent executions for the cases currently on screen, keyed by case id.
 *
 * Fetched separately from the cases themselves: the case list is assembled by
 * three different paths (search, run mode, plain listing), and keying off the
 * rendered ids means all three get the column without threading the data
 * through each one.
 */
export function useLatestTestResults(
  caseIds: number[],
  limit: number = LATEST_RESULTS_COUNT
) {
  // Sorted so paging back and forth reuses the cached entry.
  const key = [...caseIds].sort((a, b) => a - b);

  const { data } = useQuery({
    queryKey: ["latestTestResults", key, limit],
    queryFn: async () => {
      const result = await fetchLatestTestResults(key, limit);
      return result.success
        ? (result.data as Record<number, TestResultExecution[]>)
        : {};
    },
    enabled: key.length > 0,
    staleTime: 30_000,
  });

  return data ?? {};
}
