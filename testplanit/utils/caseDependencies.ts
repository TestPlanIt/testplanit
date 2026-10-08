/**
 * Test case dependency gating — the pure part.
 *
 * A `RepositoryCaseLink` of type `DEPENDS_ON` is directional: `caseA` depends
 * on `caseB`, so `caseB` is the prerequisite. Inside a test run, a case is
 * BLOCKED while any prerequisite that is also in the run has not passed
 * (`Status.isSuccess`). Prerequisites that are not in the run never block —
 * a run's behaviour depends only on state visible from the run — but they are
 * reported so the omission is visible rather than silent.
 *
 * Both the server gate (`lib/services/dependencyGate.ts`) and the run page
 * resolve blocked state through `resolveDependencyState`, so the badge a
 * tester sees and the rejection the server issues can never disagree.
 */

export const DEPENDENCY_LINK_TYPE = "DEPENDS_ON" as const;

/** A `DEPENDS_ON` edge: `caseAId` depends on `caseBId`. */
export interface DependencyLink {
  caseAId: number;
  caseBId: number;
  /** Prerequisite's name, when the caller selected it. */
  caseBName?: string | null;
}

/** A run case that may serve as a prerequisite. */
export interface PrerequisiteRunCase {
  id: number;
  repositoryCaseId: number;
  /** `status.isSuccess` of the case's current run status. */
  passed: boolean;
}

export interface BlockingPrerequisite {
  testRunCaseId: number;
  repositoryCaseId: number;
  name: string | null;
}

export interface AbsentPrerequisite {
  repositoryCaseId: number;
  name: string | null;
}

export interface CaseDependencyState {
  /** Prerequisites in the run that have not passed. Non-empty = blocked. */
  blockedBy: BlockingPrerequisite[];
  /** Prerequisites outside the run. They never block; shown as a warning. */
  notInRun: AbsentPrerequisite[];
}

/**
 * Resolves the dependency state of each case in `caseIds` from its outgoing
 * `DEPENDS_ON` links and the run cases those links point at. Keyed by
 * repository case id. A case with no dependency links has no entry.
 */
export function resolveDependencyState(args: {
  caseIds: Iterable<number>;
  links: DependencyLink[];
  prerequisiteRunCases: PrerequisiteRunCase[];
}): Map<number, CaseDependencyState> {
  const inRun = new Map<number, PrerequisiteRunCase>();
  for (const runCase of args.prerequisiteRunCases) {
    inRun.set(runCase.repositoryCaseId, runCase);
  }

  const linksByDependant = new Map<number, DependencyLink[]>();
  for (const link of args.links) {
    const list = linksByDependant.get(link.caseAId);
    if (list) list.push(link);
    else linksByDependant.set(link.caseAId, [link]);
  }

  const result = new Map<number, CaseDependencyState>();
  for (const caseId of args.caseIds) {
    const links = linksByDependant.get(caseId);
    if (!links || links.length === 0) continue;
    const state: CaseDependencyState = { blockedBy: [], notInRun: [] };
    const seen = new Set<number>();
    for (const link of links) {
      if (seen.has(link.caseBId)) continue;
      seen.add(link.caseBId);
      const prerequisite = inRun.get(link.caseBId);
      if (!prerequisite) {
        state.notInRun.push({
          repositoryCaseId: link.caseBId,
          name: link.caseBName ?? null,
        });
      } else if (!prerequisite.passed) {
        state.blockedBy.push({
          testRunCaseId: prerequisite.id,
          repositoryCaseId: prerequisite.repositoryCaseId,
          name: link.caseBName ?? null,
        });
      }
    }
    result.set(caseId, state);
  }
  return result;
}

export function isBlockedByDependencies(
  state: CaseDependencyState | undefined
): boolean {
  return !!state && state.blockedBy.length > 0;
}
