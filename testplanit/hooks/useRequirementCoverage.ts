import {
  useQuery,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { RequirementCoverageResponse } from "~/app/api/projects/[projectId]/requirements/coverage/route";
import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";

/** The literal first element of every query key this hook issues. Exported
 *  so the predicate below and its test share one source of truth instead of
 *  two copies of the string that could drift apart. */
export const REQUIREMENT_COVERAGE_QUERY_KEY_ROOT = "requirementCoverage";

/**
 * The predicate `invalidateRequirementCoverage` is built on, exported on its
 * own so a test can assert what it actually discriminates: this hook's own
 * key for the given project, and nothing else -- not a different project's
 * coverage key, and not `useRequirementCoveringCases`' key even though both
 * literal strings share a 16-character prefix ("requirementCover"). A bare
 * key-prefix `invalidateQueries({queryKey: ["requirementCoverage"]})` would
 * happen to work today (this hook's own key array literally starts with
 * that string), but this project's established lesson is that React
 * Query/ZenStack key matching needs an explicit predicate, not a prefix --
 * so this is written as one from the start rather than relying on the
 * coincidence.
 */
export function isRequirementCoverageQueryKey(
  queryKey: QueryKey,
  projectId: number
): boolean {
  return (
    Array.isArray(queryKey) &&
    queryKey[0] === REQUIREMENT_COVERAGE_QUERY_KEY_ROOT &&
    queryKey[1] === projectId
  );
}

/**
 * Invalidates the one whole-project coverage rollup query. This is the only
 * query per project (shared by the tree badge and the uncovered filter, see
 * the hook below), so callers invoke this once per mutation -- never once
 * per node -- after link, unlink, create, reparent, or delete change what
 * the rollup should say.
 */
export function invalidateRequirementCoverage(
  queryClient: QueryClient,
  projectId: number
): void {
  void queryClient.invalidateQueries({
    predicate: (query) =>
      isRequirementCoverageQueryKey(query.queryKey, projectId),
  });
}

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
 * page — share one cache entry instead of firing two requests. Nothing in
 * this hook self-invalidates on a timer beyond that `staleTime`; callers
 * that mutate what the rollup should say invoke `invalidateRequirementCoverage`
 * explicitly (see `LinkedRequirementCasesPanel.tsx` and
 * `RequirementsListView.tsx`).
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
 * One requirement's coverage breakdown, scoped server-side.
 *
 * Separate from `useRequirementCoverage` (and deliberately NOT sharing its
 * cache entry) because the two answer different questions at very different
 * costs. The whole-project rollup is right for the list, which paints a chip
 * on every row; for a single requirement's detail page it would download the
 * entire project to read one entry -- ~2.4MB and ~2s on an
 * 11,000-requirement project. The breakdown itself is identical either way:
 * each is computed over that requirement's own whole subtree.
 */
export function useRequirementCoverageBreakdown(
  projectId: number | undefined,
  requirementId: number | null | undefined
) {
  const enabled = Number.isFinite(projectId) && Number.isFinite(requirementId);
  const query = useQuery<RequirementCoverageResponse>({
    queryKey: ["requirementCoverage", projectId, "one", requirementId],
    queryFn: async () => {
      const response = await fetch(
        `/api/projects/${projectId}/requirements/coverage?requirementIds=${requirementId}`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch requirement coverage");
      }
      return response.json();
    },
    enabled,
  });

  return {
    breakdown: enabled
      ? coverageFor(query.data, Number(requirementId))
      : undefined,
    isLoading: query.isLoading,
    isError: query.isError,
  };
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
  // `coverage` is optional-chained too, not just `data`: a response that
  // resolved without that key (a stubbed fetch, a future error envelope)
  // would otherwise throw while indexing `undefined`, taking the calling
  // component down with it rather than reading as "no breakdown yet".
  return data?.coverage?.[String(requirementId)];
}
