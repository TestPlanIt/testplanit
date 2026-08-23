import { useQuery } from "@tanstack/react-query";
import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";

/**
 * `getRequirementCoverage` is a `WITH RECURSIVE` kysely CTE with no
 * ZenStack model to generate a hook from — this project prefers
 * generated hooks, but the whole Milestone family (`summary`,
 * `burndown`, `members/coverage`, `export`) made the identical
 * hand-written-hook call for the identical reason. This hook mirrors
 * `useMilestoneSummary` verbatim.
 *
 * `staleTime: 30000` plus a stable `queryKey` array so the tree badge and
 * the uncovered filter — both reading coverage on the same requirements
 * page — share one cache entry instead of firing two requests.
 */
export function useRequirementCoverage(projectId: number | undefined) {
  return useQuery<RequirementCoverageResponse>({
    queryKey: ["requirementCoverage", projectId],
    queryFn: async () => {
      const response = await fetch(
        `/api/projects/${projectId}/requirements/coverage`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch requirement coverage");
      }
      return response.json();
    },
    enabled: Number.isFinite(projectId),
    staleTime: 30000,
  });
}

/**
 * The one place the route's `String(id)` key convention lives. The route
 * serializes its `Map<number, RequirementCoverageBreakdown>` through
 * `Object.fromEntries`, which stringifies every key — callers index with
 * `String(requirementId)` rather than re-deriving that fact themselves.
 */
export function coverageFor(
  data: RequirementCoverageResponse | undefined,
  requirementId: number
): RequirementCoverageBreakdown | undefined {
  return data?.coverage[String(requirementId)];
}
