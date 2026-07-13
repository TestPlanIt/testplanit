import { useQuery } from "@tanstack/react-query";
import type { MilestoneBurndownData } from "~/app/api/milestones/[milestoneId]/burndown/route";

/**
 * Fetcher for `/api/milestones/{id}/burndown` (fast-follow READY, D4). Returns
 * the per-day remaining-work series the detail page plots as a burndown. Keyed
 * on `["milestoneBurndown", milestoneId]` so the SSE wake-up on the detail page
 * can invalidate it alongside the summary/coverage queries.
 */
export function useMilestoneBurndown(milestoneId: number | undefined) {
  return useQuery<MilestoneBurndownData>({
    queryKey: ["milestoneBurndown", milestoneId],
    queryFn: async () => {
      const response = await fetch(`/api/milestones/${milestoneId}/burndown`);
      if (!response.ok) {
        throw new Error("Failed to fetch milestone burndown");
      }
      return response.json();
    },
    enabled: !!milestoneId,
    staleTime: 30000,
  });
}
