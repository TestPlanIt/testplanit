import { useQuery } from "@tanstack/react-query";
import type { RequirementCoveringCasesResponse } from "~/app/api/projects/[projectId]/requirements/[issueId]/covering-cases/route";

/**
 * Client seam for the per-requirement covering-case drill-down panel.
 * Mirrors `useMilestoneSummary` and `useRequirementCoverage` verbatim:
 * `staleTime: 30000` plus a stable `queryKey` array so a panel that
 * re-mounts on the same requirement reuses one cache entry instead of
 * re-fetching.
 *
 * `enabled` on both ids being finite — this is a per-requirement route
 * (no batch endpoint), so an undefined `requirementId` (nothing selected
 * yet) must not fire a request at all.
 */
export function useRequirementCoveringCases(
  projectId: number | undefined,
  requirementId: number | undefined
) {
  return useQuery<RequirementCoveringCasesResponse>({
    queryKey: ["requirementCoveringCases", projectId, requirementId],
    queryFn: async () => {
      const response = await fetch(
        `/api/projects/${projectId}/requirements/${requirementId}/covering-cases`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch requirement covering cases");
      }
      return response.json();
    },
    enabled: Number.isFinite(projectId) && Number.isFinite(requirementId),
    staleTime: 30000,
  });
}
