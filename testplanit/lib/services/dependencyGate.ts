/**
 * Dependency gate for test run results.
 *
 * Opt-in per project (`Projects.enforceCaseDependencies`). When it is on, a
 * run case whose `DEPENDS_ON` prerequisites in the SAME run have not all
 * passed is blocked: the run marks it, and every server path that records a
 * result for it refuses with `DependencyGateError`. Prerequisites outside the
 * run never block (see `utils/caseDependencies.ts` for the rules).
 *
 * The gate runs inside the result writer's transaction, in the same preflight
 * position as the review gate, so the check and the write are atomic. The
 * handoff half — telling a dependant's assignee the gate just opened — is
 * `findUnblockedDependants`, evaluated in the same transaction right after
 * the prerequisite's status is written and delivered after commit.
 */

import { DependencyGateError } from "~/lib/utils/errors";
import {
  DEPENDENCY_LINK_TYPE,
  resolveDependencyState,
  type BlockingPrerequisite,
  type CaseDependencyState,
  type DependencyLink,
} from "~/utils/caseDependencies";

/**
 * The reads the gate needs. Structural so it accepts the base client, a
 * `TxClient`, or the plugin's un-proxied client alike.
 */
export type DependencyGateReader = {
  repositoryCaseLink: { findMany: (args: any) => Promise<any[]> };
  testRunCases: { findMany: (args: any) => Promise<any[]> };
};

const unique = (ids: number[]): number[] => Array.from(new Set(ids));

/**
 * Resolves the dependency state of the given cases within one run. Two
 * queries: the cases' outgoing `DEPENDS_ON` links, then the run rows of the
 * prerequisites those links name. Keyed by repository case id; cases without
 * dependency links have no entry.
 */
export async function loadDependencyState(
  db: DependencyGateReader,
  params: { testRunId: number; repositoryCaseIds: number[] }
): Promise<Map<number, CaseDependencyState>> {
  const caseIds = unique(params.repositoryCaseIds);
  if (caseIds.length === 0) return new Map();

  const links: DependencyLink[] = (
    await db.repositoryCaseLink.findMany({
      where: {
        caseAId: { in: caseIds },
        type: DEPENDENCY_LINK_TYPE,
        isDeleted: false,
      },
      select: {
        caseAId: true,
        caseBId: true,
        caseB: { select: { name: true } },
      },
    })
  ).map((link) => ({
    caseAId: link.caseAId,
    caseBId: link.caseBId,
    caseBName: link.caseB?.name ?? null,
  }));
  if (links.length === 0) return new Map();

  const prerequisiteRunCases = (
    await db.testRunCases.findMany({
      where: {
        testRunId: params.testRunId,
        repositoryCaseId: { in: unique(links.map((l) => l.caseBId)) },
        isDeleted: false,
      },
      select: {
        id: true,
        repositoryCaseId: true,
        status: { select: { isSuccess: true } },
      },
    })
  ).map((runCase) => ({
    id: runCase.id as number,
    repositoryCaseId: runCase.repositoryCaseId as number,
    passed: runCase.status?.isSuccess === true,
  }));

  return resolveDependencyState({ caseIds, links, prerequisiteRunCases });
}

/** Prerequisites in the run that keep `repositoryCaseId` blocked. */
export async function findBlockingPrerequisites(
  db: DependencyGateReader,
  params: { testRunId: number; repositoryCaseId: number }
): Promise<BlockingPrerequisite[]> {
  const state = await loadDependencyState(db, {
    testRunId: params.testRunId,
    repositoryCaseIds: [params.repositoryCaseId],
  });
  return state.get(params.repositoryCaseId)?.blockedBy ?? [];
}

/**
 * Dependency-gate preflight. Throws `DependencyGateError` when the case is
 * blocked. Callers skip it entirely when the project has not enabled
 * enforcement — the gate reads nothing in that case.
 */
export async function assertDependencyGateOpen(
  db: DependencyGateReader,
  params: { testRunId: number; repositoryCaseId: number }
): Promise<void> {
  const blockedBy = await findBlockingPrerequisites(db, params);
  if (blockedBy.length > 0) {
    throw new DependencyGateError(
      params.testRunId,
      params.repositoryCaseId,
      blockedBy
    );
  }
}

export interface UnblockedDependant {
  testRunCaseId: number;
  repositoryCaseId: number;
  name: string;
  assignedToId: string | null;
}

/**
 * The run cases that depend on `repositoryCaseId` and are now fully open:
 * every one of their prerequisites in this run has passed. Called after the
 * prerequisite's status is written (inside the same transaction, so the
 * answer reflects it); the caller notifies each dependant's assignee.
 */
export async function findUnblockedDependants(
  db: DependencyGateReader,
  params: { testRunId: number; repositoryCaseId: number }
): Promise<UnblockedDependant[]> {
  const dependantLinks = await db.repositoryCaseLink.findMany({
    where: {
      caseBId: params.repositoryCaseId,
      type: DEPENDENCY_LINK_TYPE,
      isDeleted: false,
    },
    select: { caseAId: true },
  });
  if (dependantLinks.length === 0) return [];

  const dependants: Array<{
    id: number;
    repositoryCaseId: number;
    assignedToId: string | null;
    repositoryCase: { name: string } | null;
  }> = await db.testRunCases.findMany({
    where: {
      testRunId: params.testRunId,
      repositoryCaseId: {
        in: unique(dependantLinks.map((l) => l.caseAId as number)),
      },
      isDeleted: false,
    },
    select: {
      id: true,
      repositoryCaseId: true,
      assignedToId: true,
      repositoryCase: { select: { name: true } },
    },
  });
  if (dependants.length === 0) return [];

  const state = await loadDependencyState(db, {
    testRunId: params.testRunId,
    repositoryCaseIds: dependants.map((d) => d.repositoryCaseId),
  });

  return dependants
    .filter((d) => (state.get(d.repositoryCaseId)?.blockedBy.length ?? 0) === 0)
    .map((d) => ({
      testRunCaseId: d.id,
      repositoryCaseId: d.repositoryCaseId,
      name: d.repositoryCase?.name ?? "",
      assignedToId: d.assignedToId ?? null,
    }));
}
