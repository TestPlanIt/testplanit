import { useQuery } from "@tanstack/react-query";

export interface UseRequirementSubtreeCountArgs {
  projectId: number;
  requirementId: number | null;
  enabled: boolean;
}

export interface UseRequirementSubtreeCountResult {
  count: number | null;
  isLoading: boolean;
  /**
   * Separate from `isLoading` because React Query's `isLoading` is
   * `isPending && isFetching`: once a query settles into `status: "error"`
   * it is FALSE while `data` stays undefined. A consumer that gates only on
   * `isLoading` therefore reads a failed request as "finished, no data" --
   * which is the exact state that must not become `0`. Gate on
   * `isLoading || isError`, or simply pass `count` through untouched.
   */
  isError: boolean;
  error: unknown;
}

/**
 * The lazy-mode sibling of `useFindManyRepositoryCasesByDescendants`
 * (`hooks/useRepositoryCasesByDescendants.ts`) -- a server-side subtree count
 * instead of an in-memory `childrenMap` walk, feeding
 * `DeleteRequirementModal`'s confirmation copy once the requirements tree can
 * no longer assume every requirement is already loaded (28-08's
 * `getRequirementSubtreeCount`, exposed via
 * `GET /api/projects/{projectId}/requirements/{issueId}/descendant-count`).
 *
 * `count` is `null` while loading and stays `null` on error -- deliberately,
 * not `0`. `DeleteFolderModal.tsx`'s own consumption idiom
 * (`open ? (isLoading ? null : count ?? 0) : 0`) is the reason: a delete
 * confirmation that renders "and 0 child requirements" for a moment before
 * the real count arrives is a confirmation the user could act on based on a
 * number that was never true.
 */
export function useRequirementSubtreeCount({
  projectId,
  requirementId,
  enabled,
}: UseRequirementSubtreeCountArgs): UseRequirementSubtreeCountResult {
  const query = useQuery({
    queryKey: ["requirementSubtreeCount", projectId, requirementId],
    enabled: enabled && requirementId !== null,
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/requirements/${requirementId}/descendant-count`
      );
      if (!res.ok) {
        throw new Error(
          `Failed to fetch requirement subtree count (status ${res.status})`
        );
      }
      return res.json() as Promise<{ count: number }>;
    },
    refetchOnWindowFocus: false,
  });

  return {
    count: query.data?.count ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
