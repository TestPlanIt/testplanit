import { WorkflowScope } from "~/zenstack/models";
import type { TxClient } from "~/lib/zenstack";
import { resolveCreateStateRemap } from "~/lib/services/reviewGate";

/**
 * Shared workflow-state resolution for copy/move.
 *
 * The preflight route previews how each source case's state lands in the
 * target project and the copy-move worker executes that landing; both MUST
 * resolve through this module so the preview and the outcome cannot drift.
 */

export interface CaseWorkflowState {
  id: number;
  name: string;
  isDefault: boolean;
}

/**
 * The CASES-scoped, non-deleted workflow states assigned to a project.
 *
 * Workflow state names repeat across scopes ("Under Review" and "Done" exist
 * for SESSIONS and RUNS too), so every lookup that resolves a test case's
 * state must filter to the CASES scope — going through this helper makes the
 * filter impossible to forget.
 */
export async function getCasesWorkflowAssignments(
  db: TxClient,
  projectId: number
): Promise<CaseWorkflowState[]> {
  const assignments = await db.projectWorkflowAssignment.findMany({
    where: {
      projectId,
      workflow: { scope: WorkflowScope.CASES, isDeleted: false },
    },
    select: {
      workflow: { select: { id: true, name: true, isDefault: true } },
    },
  });
  return assignments.map((a: { workflow: CaseWorkflowState }) => a.workflow);
}

/**
 * Real workflow names for a set of state ids, straight from the workflows
 * table. Case rows can hold stale stateIds (the workflow was later unassigned
 * from the project or soft-deleted), so name resolution must not depend on a
 * project's current assignments.
 */
export async function getWorkflowNamesByIds(
  db: TxClient,
  stateIds: number[]
): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  if (stateIds.length === 0) return names;
  const rows = await db.workflows.findMany({
    where: { id: { in: stateIds } },
    select: { id: true, name: true },
  });
  for (const row of rows as Array<{ id: number; name: string }>) {
    names.set(row.id, row.name);
  }
  return names;
}

export interface MappedCaseState {
  stateId: number;
  /** Which precedence branch resolved the state. */
  via: "exact" | "name" | "default";
}

export interface CaseStateMapper {
  /**
   * Resolve a source state into the target project. Precedence: the target
   * already has the exact state assigned (always true for a same-project
   * operation) -> keep it; a target state matches by name (case-insensitive,
   * using `nameHint` when given — e.g. a version snapshot's stateName — or the
   * workflows-table name otherwise) -> use it; else the target default.
   * Returns undefined only when the target has no states at all.
   */
  map(
    sourceStateId: number,
    nameHint?: string | null
  ): MappedCaseState | undefined;
  /** Name of a target state, for display. */
  targetName(stateId: number): string | undefined;
  /** The target default (or first) state id, if any. */
  defaultStateId: number | undefined;
}

export function createCaseStateMapper(
  targetStates: CaseWorkflowState[],
  sourceStateNames: Map<number, string>
): CaseStateMapper {
  const targetIds = new Set(targetStates.map((s) => s.id));
  const targetByName = new Map<string, number>();
  const targetNameById = new Map<number, string>();
  for (const s of targetStates) {
    targetByName.set(s.name.toLowerCase(), s.id);
    targetNameById.set(s.id, s.name);
  }
  const defaultStateId =
    targetStates.find((s) => s.isDefault)?.id ?? targetStates[0]?.id;

  return {
    map(sourceStateId, nameHint) {
      if (targetIds.has(sourceStateId)) {
        return { stateId: sourceStateId, via: "exact" };
      }
      const name = nameHint ?? sourceStateNames.get(sourceStateId);
      const byName = name ? targetByName.get(name.toLowerCase()) : undefined;
      if (byName !== undefined) return { stateId: byName, via: "name" };
      if (defaultStateId !== undefined) {
        return { stateId: defaultStateId, via: "default" };
      }
      return undefined;
    },
    targetName(stateId) {
      return targetNameById.get(stateId);
    },
    defaultStateId,
  };
}

/**
 * Memoized review-gate remap for states being written onto rows that are
 * genuinely created in the target project. When the gate rejects the
 * candidate but the project has no default state to divert to (a seed gap),
 * the candidate is kept — there is no safer state to substitute.
 */
export function createGatedStateResolver(
  db: TxClient,
  targetProjectId: number
): (candidateStateId: number) => Promise<number> {
  const cache = new Map<number, number>();
  return async (candidateStateId: number) => {
    const cached = cache.get(candidateStateId);
    if (cached !== undefined) return cached;
    const remapped =
      (await resolveCreateStateRemap(
        db,
        targetProjectId,
        WorkflowScope.CASES,
        candidateStateId
      )) ?? candidateStateId;
    cache.set(candidateStateId, remapped);
    return remapped;
  };
}

/**
 * A project's active repository, deterministically (lowest id wins when a
 * project has more than one active repository — imports can create extras).
 */
export async function findActiveRepository(
  db: TxClient,
  projectId: number
): Promise<{ id: number } | null> {
  return db.repositories.findFirst({
    where: { projectId, isActive: true, isDeleted: false },
    orderBy: { id: "asc" },
    select: { id: true },
  });
}
