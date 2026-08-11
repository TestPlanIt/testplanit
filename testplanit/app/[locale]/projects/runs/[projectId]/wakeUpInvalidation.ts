/**
 * Per-run matching for the runs list page's TestRunCases invalidation.
 *
 * The list holds one TestRunCases query per mounted tile, so invalidating the
 * bare ["zenstack", "TestRunCases"] prefix on a wake-up refetches every tile
 * for a change that touched one run.
 *
 * The run id cannot be pushed into the query key. @zenstackhq/tanstack-query
 * stamps [QUERY_KEY_PREFIX, model, operation, args, flags] and the id lives
 * inside `args` (`{ where: { testRunId } }`); TanStack matches keys by prefix,
 * which cannot reach past `operation` to constrain `args`. A predicate can —
 * it ANDs with the prefix filter — so the match happens here instead.
 */

const ARGS_INDEX = 3;

/**
 * True when a TestRunCases query should be refetched for this wake-up round.
 *
 * Queries whose args don't pin a scalar `testRunId` match unconditionally:
 * every reader on this route does pin one today, and anything that stops
 * doing so should keep the old refetch-everything behaviour rather than
 * silently go stale.
 */
export function testRunCasesQueryMatchesRuns(
  queryKey: readonly unknown[],
  runIds: ReadonlySet<number | null>
): boolean {
  const args = queryKey[ARGS_INDEX] as
    { where?: { testRunId?: unknown } } | undefined;
  const testRunId = args?.where?.testRunId;
  if (typeof testRunId !== "number") return true;
  return runIds.has(testRunId);
}
