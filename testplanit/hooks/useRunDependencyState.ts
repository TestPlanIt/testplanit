import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useMemo } from "react";
import { schema } from "~/zenstack/schema";
import {
  DEPENDENCY_LINK_TYPE,
  resolveDependencyState,
  type CaseDependencyState,
} from "~/utils/caseDependencies";

/**
 * Dependency state of every case in a run, keyed by repository case id — the
 * client-side mirror of the server gate, resolved by the same
 * `resolveDependencyState` so the run marks exactly the cases the server
 * would refuse a result for.
 *
 * Two lean ZenStack queries (the run's live cases with their pass flag, and
 * the live `DEPENDS_ON` links whose dependant is in the run). They share the
 * ZenStack cache keys every result submission already invalidates, so the
 * blocked badges update with the statuses. Callers pass `enabled: false` when
 * the project does not enforce dependencies; nothing is fetched then.
 */
export function useRunDependencyState(
  testRunId: number | null | undefined,
  enabled: boolean
): Map<number, CaseDependencyState> {
  const active = enabled && typeof testRunId === "number" && testRunId > 0;

  const { data: runCases } = useClientQueries(schema).testRunCases.useFindMany(
    {
      where: { testRunId: testRunId ?? -1, isDeleted: false },
      select: {
        id: true,
        repositoryCaseId: true,
        status: { select: { isSuccess: true } },
      },
    },
    { enabled: active }
  );

  const { data: links } = useClientQueries(
    schema
  ).repositoryCaseLink.useFindMany(
    {
      where: {
        type: DEPENDENCY_LINK_TYPE,
        isDeleted: false,
        caseA: {
          testRunCases: {
            some: { testRunId: testRunId ?? -1, isDeleted: false },
          },
        },
      },
      select: {
        caseAId: true,
        caseBId: true,
        caseB: { select: { name: true } },
      },
    },
    { enabled: active }
  );

  return useMemo(() => {
    if (!active || !runCases || !links) return new Map();
    return resolveDependencyState({
      caseIds: runCases.map((rc) => rc.repositoryCaseId),
      links: links.map((link) => ({
        caseAId: link.caseAId,
        caseBId: link.caseBId,
        caseBName: link.caseB?.name ?? null,
      })),
      prerequisiteRunCases: runCases.map((rc) => ({
        id: rc.id,
        repositoryCaseId: rc.repositoryCaseId,
        passed: rc.status?.isSuccess === true,
      })),
    });
  }, [active, runCases, links]);
}
