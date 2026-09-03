/**
 * Client-side shape and serializers for the requirement coverage family's
 * execution scope (milestone/configuration — the hybrid opt-in frame; the
 * server twin is `lib/services/executionScopeParam.ts`). One module so the
 * requirements page, the coverage hooks, and the report builder all agree
 * on "inactive axis = empty array, omitted on the wire".
 */

export interface RequirementExecutionScopeSelection {
  milestoneIds: number[];
  configIds: number[];
}

export const EMPTY_EXECUTION_SCOPE: RequirementExecutionScopeSelection = {
  milestoneIds: [],
  configIds: [],
};

export function isExecutionScopeSelectionActive(
  scope: RequirementExecutionScopeSelection | undefined | null
): boolean {
  return Boolean(
    scope && (scope.milestoneIds.length > 0 || scope.configIds.length > 0)
  );
}

/** Appends the active axes as `milestoneIds=1,2&configIds=3` — nothing at
 * all when the scope is inactive, so an unscoped request's URL (and its
 * cache key) is byte-identical to what shipped before the scope existed. */
export function appendExecutionScopeParams(
  params: URLSearchParams,
  scope: RequirementExecutionScopeSelection | undefined | null
): void {
  if (!scope) return;
  if (scope.milestoneIds.length > 0) {
    params.set("milestoneIds", scope.milestoneIds.join(","));
  }
  if (scope.configIds.length > 0) {
    params.set("configIds", scope.configIds.join(","));
  }
}

/** The POST-body twin of `appendExecutionScopeParams`: active axes only,
 * as arrays, spread into the request body. */
export function executionScopeBodyFields(
  scope: RequirementExecutionScopeSelection | undefined | null
): { milestoneIds?: number[]; configIds?: number[] } {
  if (!scope) return {};
  return {
    ...(scope.milestoneIds.length > 0
      ? { milestoneIds: scope.milestoneIds }
      : {}),
    ...(scope.configIds.length > 0 ? { configIds: scope.configIds } : {}),
  };
}

/** True when a snapshot row was captured under an execution scope — the
 * stored axes are raw JSON (`unknown`) as ZenStack serves them. */
export function isSnapshotExecutionScoped(option: {
  scopeMilestoneIds?: unknown;
  scopeConfigIds?: unknown;
}): boolean {
  return (
    (Array.isArray(option.scopeMilestoneIds) &&
      option.scopeMilestoneIds.length > 0) ||
    (Array.isArray(option.scopeConfigIds) && option.scopeConfigIds.length > 0)
  );
}

/** Stable key fragment for react-query keys: sorted, so two selections of
 * the same ids in a different click order share one cache entry. */
export function executionScopeKey(
  scope: RequirementExecutionScopeSelection | undefined | null
): string {
  if (!isExecutionScopeSelectionActive(scope)) return "";
  const m = [...(scope?.milestoneIds ?? [])].sort((a, b) => a - b).join(",");
  const c = [...(scope?.configIds ?? [])].sort((a, b) => a - b).join(",");
  return `m:${m}|c:${c}`;
}
