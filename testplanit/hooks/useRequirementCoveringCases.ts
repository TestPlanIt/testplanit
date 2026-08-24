import { useQuery, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { RequirementCoveringCasesResponse } from "~/app/api/projects/[projectId]/requirements/[issueId]/covering-cases/route";

/** The literal first element of every query key this hook issues. Exported
 *  for the same reason `useRequirementCoverage.ts` exports its own root
 *  string -- one source of truth for the predicate and its test. */
export const REQUIREMENT_COVERING_CASES_QUERY_KEY_ROOT =
  "requirementCoveringCases";

/**
 * The predicate `invalidateRequirementCoveringCases` is built on. `requirementId`
 * is optional: callers that only know the project (e.g. after a subtree
 * reparent) can invalidate every open drill-down for that project, while
 * callers that know exactly which requirement changed (link/unlink) can
 * narrow to it. Exported so a test can assert this matches its own key and
 * rejects `useRequirementCoverage`'s key even though both literal strings
 * share a 16-character prefix ("requirementCover") -- see that hook's own
 * predicate doc comment for why a predicate, not a prefix, is required here.
 */
export function isRequirementCoveringCasesQueryKey(
  queryKey: QueryKey,
  projectId: number,
  requirementId?: number
): boolean {
  return (
    Array.isArray(queryKey) &&
    queryKey[0] === REQUIREMENT_COVERING_CASES_QUERY_KEY_ROOT &&
    queryKey[1] === projectId &&
    (requirementId === undefined || queryKey[2] === requirementId)
  );
}

/**
 * Invalidates the per-requirement covering-case drill-down query (or every
 * open drill-down for the project when `requirementId` is omitted).
 */
export function invalidateRequirementCoveringCases(
  queryClient: QueryClient,
  projectId: number,
  requirementId?: number
): void {
  void queryClient.invalidateQueries({
    predicate: (query) =>
      isRequirementCoveringCasesQueryKey(
        query.queryKey,
        projectId,
        requirementId
      ),
  });
}

/**
 * Client seam for the per-requirement covering-case drill-down panel.
 * Mirrors `useMilestoneSummary` and `useRequirementCoverage` verbatim:
 * `staleTime: 30000` plus a stable `queryKey` array so a panel that
 * re-mounts on the same requirement reuses one cache entry instead of
 * re-fetching.
 *
 * `enabled` on both ids being finite — this is a per-requirement route
 * (no batch endpoint), so an undefined `requirementId` (nothing selected
 * yet) must not fire a request at all. Nothing here self-invalidates beyond
 * `staleTime`; callers that mutate coverage invoke
 * `invalidateRequirementCoveringCases` explicitly (see
 * `LinkedRequirementCasesPanel.tsx`).
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
