import { useQuery } from "@tanstack/react-query";
import type { MilestoneSummaryData } from "~/app/api/milestones/[milestoneId]/summary/route";

/**
 * Shared fetcher for `/api/milestones/{id}/summary`, keyed identically to
 * `MilestoneSummary`'s own query (`["milestoneSummary", milestoneId]`) so
 * any other consumer on the same page — e.g. the "Found in testing" issues
 * section — reads the same React Query cache entry instead of firing a
 * duplicate request.
 */
export function useMilestoneSummary(milestoneId: number | undefined) {
  return useQuery<MilestoneSummaryData>({
    queryKey: ["milestoneSummary", milestoneId],
    queryFn: async () => {
      const response = await fetch(`/api/milestones/${milestoneId}/summary`);
      if (!response.ok) {
        throw new Error("Failed to fetch milestone summary");
      }
      return response.json();
    },
    enabled: !!milestoneId,
    staleTime: 30000,
  });
}
