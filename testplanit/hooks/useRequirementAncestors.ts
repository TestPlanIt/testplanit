"use client";

import { useQuery } from "@tanstack/react-query";
import { useRequirementSubtreeCount } from "~/hooks/useRequirementSubtreeCount";
import type { RequirementAncestorRow } from "~/lib/services/requirementTree";

/**
 * Tree context for the surfaces that show a requirement WITHOUT the list --
 * the full-width panel and the standalone requirement route.
 *
 * Both hooks below are SERVER-SCOPED: each asks about the one requirement on
 * screen. They previously shared a single `issue.useFindMany` over every
 * requirement in the project, walking `parentId` and building a `childrenMap`
 * in the browser. That was deliberate while the requirements list ran the
 * byte-identical query -- ZenStack derives its React Query key from the
 * arguments, so matching them meant one fetch served both. The list no longer
 * makes that query (it pages the tree from the server at every project size),
 * so the shared entry it was matching is gone, and what remained was an
 * 11,000-row download to render a two-name breadcrumb and a single integer.
 */

interface RequirementAncestorsResponse {
  ancestors: RequirementAncestorRow[];
}

/**
 * The chain of requirements above `requirementId`, outermost first, for the
 * detail panel's breadcrumb.
 *
 * Ordering, the classification rule (a non-requirement parent ends the
 * chain), and the cycle cap all live in the SQL now -- see
 * `getRequirementAncestorChain`. A parent the viewer cannot see ends the
 * chain there too, so the breadcrumb still shows only the part of the path
 * the viewer may actually reach.
 */
export function useRequirementAncestors(
  projectId: number | undefined,
  requirementId: number | null | undefined
): { ancestors: RequirementAncestorRow[]; isLoading: boolean } {
  const enabled = Number.isFinite(projectId) && Number.isFinite(requirementId);
  const { data, isLoading } = useQuery<RequirementAncestorsResponse>({
    queryKey: ["requirementAncestors", projectId, requirementId],
    queryFn: async () => {
      const response = await fetch(
        `/api/projects/${projectId}/requirements/${requirementId}/ancestors`
      );
      if (!response.ok) {
        throw new Error(
          `Failed to fetch requirement ancestors (status ${response.status})`
        );
      }
      return response.json();
    },
    enabled,
  });

  return { ancestors: data?.ancestors ?? [], isLoading };
}

/**
 * How many requirements sit beneath `requirementId`, which is what
 * `DeleteRequirementModal` needs to say how much a delete takes with it.
 *
 * Delegates to `useRequirementSubtreeCount`, the same hook and the same
 * `descendant-count` route the requirements list already uses for this
 * exact number -- so the standalone route and the list can no longer
 * disagree about what "descendant" means.
 *
 * `isLoading` matters here in a way it does not for the breadcrumb: a count
 * that is still 0 because nothing has loaded would tell the user a delete is
 * harmless when it is not, so callers must gate the affordance on it. A
 * FAILED count reports as loading for the same reason -- never as 0.
 */
export function useRequirementDescendantCount(
  projectId: number | undefined,
  requirementId: number | null | undefined
): { descendantCount: number; isLoading: boolean } {
  const { count, isLoading, isError } = useRequirementSubtreeCount({
    projectId: Number(projectId),
    requirementId: requirementId ?? null,
    enabled: Number.isFinite(projectId) && Number.isFinite(requirementId),
  });

  return {
    descendantCount: count ?? 0,
    isLoading: isLoading || isError || count === null,
  };
}
