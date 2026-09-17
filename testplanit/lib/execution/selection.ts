/**
 * Narrow a run-page bulk selection to the automated cases an execution may
 * cover. The case table hands over its selection keyed by repository case id
 * (single run) or by TestRunCases id (a multi-configuration view merges
 * sibling runs, so only the run-case id is unique there); the run page knows
 * every automated case in its own run under both ids, so the intersection is
 * computed here and the execute request only ever carries automated cases
 * from this run.
 */

export type RunCaseSelectionKey = "repositoryCaseId" | "testRunCaseId";

export interface RunCaseSelection {
  ids: number[];
  keyedBy: RunCaseSelectionKey;
}

export const EMPTY_RUN_CASE_SELECTION: RunCaseSelection = {
  ids: [],
  keyedBy: "repositoryCaseId",
};

/** An automated case of the run: its TestRunCases row id and repository case id. */
export interface AutomatedRunCase {
  id: number;
  repositoryCaseId: number;
}

/**
 * Repository case ids of the selected rows that are automated cases in this
 * run, in the run's own order. Ids that are not automated, or belong to a
 * sibling run in a multi-configuration view, fall out.
 */
export function selectedAutomatedCaseIds(
  selection: RunCaseSelection,
  automatedRunCases: readonly AutomatedRunCase[]
): number[] {
  if (selection.ids.length === 0 || automatedRunCases.length === 0) return [];
  const selected = new Set(selection.ids);
  const seen = new Set<number>();
  const result: number[] = [];
  for (const runCase of automatedRunCases) {
    const key =
      selection.keyedBy === "testRunCaseId"
        ? runCase.id
        : runCase.repositoryCaseId;
    if (!selected.has(key) || seen.has(runCase.repositoryCaseId)) continue;
    seen.add(runCase.repositoryCaseId);
    result.push(runCase.repositoryCaseId);
  }
  return result;
}
