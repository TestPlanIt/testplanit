import {
  useQuery,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { CaseLatestExecutionResponse } from "~/app/api/repository-cases/[caseId]/latest-execution/route";

/** The literal first element of every query key this hook issues. Exported
 *  for the same reason `useRequirementCoveringCases.ts` and
 *  `useRequirementCoverage.ts` export their own root strings -- one source
 *  of truth for the predicate and its test. */
export const CASE_LATEST_EXECUTION_QUERY_KEY_ROOT = "caseLatestExecution";

/**
 * The predicate `invalidateCaseLatestExecution` is built on. `caseId` is
 * optional so a caller that only wants to sweep every open panel can omit
 * it. Exported so a test can assert what it actually discriminates: this
 * hook's own key, and NOT `useRequirementCoveringCases`' or
 * `useRequirementCoverage`'s keys for the same numeric id -- a predicate,
 * never a key-prefix match.
 *
 * `hooks/useRequirementCaseLinks.ts` carries a shared invalidation
 * predicate for the linkage family (`invalidateLinkedQueries`), but it
 * matches key CONTENT: it only fires for a query whose serialized key
 * mentions `"RepositoryCases"` or `"Issue"` (the 26.1 lesson). This hook's
 * key -- `["caseLatestExecution", caseId]` -- mentions neither literal, so
 * it would silently drop out of that shared sweep. That is exactly why it
 * ships its own predicate and its own invalidator here rather than relying
 * on the shared one.
 */
export function isCaseLatestExecutionQueryKey(
  queryKey: QueryKey,
  caseId?: number
): boolean {
  return (
    Array.isArray(queryKey) &&
    queryKey[0] === CASE_LATEST_EXECUTION_QUERY_KEY_ROOT &&
    (caseId === undefined || queryKey[1] === caseId)
  );
}

/**
 * Invalidates this case's latest-execution query (or every open one when
 * `caseId` is omitted).
 */
export function invalidateCaseLatestExecution(
  queryClient: QueryClient,
  caseId?: number
): void {
  void queryClient.invalidateQueries({
    predicate: (query) => isCaseLatestExecutionQueryKey(query.queryKey, caseId),
  });
}

/**
 * Client seam for the case-side suspect computation's one missing value:
 * this case's own last execution timestamp. `components/requirements/LinkedRequirementsPanel.tsx`
 * lists requirements for ONE case, so `executed_at` is invariant across
 * every row -- a single value, not a per-row map -- which is why this is a
 * hand-written hook keyed on `caseId` alone rather than a generated
 * ZenStack hook: the value comes from a raw CTE composition
 * (`getCaseLatestExecutedAt`) ZenStack cannot express.
 *
 * Mirrors `useRequirementCoveringCases` and `useRequirementCoverage`
 * verbatim: `staleTime: 30000` plus a stable `queryKey` array so a panel
 * that re-mounts on the same case reuses one cache entry instead of
 * re-fetching. `enabled` on `caseId` being finite -- an undefined caseId
 * (nothing selected yet) must not fire a request at all.
 */
export function useCaseLatestExecution(caseId: number | undefined) {
  return useQuery<CaseLatestExecutionResponse>({
    queryKey: [CASE_LATEST_EXECUTION_QUERY_KEY_ROOT, caseId],
    queryFn: async () => {
      const response = await fetch(
        `/api/repository-cases/${caseId}/latest-execution`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch case latest execution");
      }
      return response.json();
    },
    enabled: Number.isFinite(caseId),
    staleTime: 30000,
  });
}
