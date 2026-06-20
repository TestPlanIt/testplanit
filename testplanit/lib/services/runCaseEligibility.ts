/**
 * Eligibility helpers for adding RepositoryCases to a TestRun.
 *
 * Centralizes the per-project "exclude NOT_STARTED workflow-state cases from
 * runs" rule (`Projects.excludeNotStartedFromRuns`). All add-to-run entry
 * points — `AddTestRunModal`, `DuplicateTestRunDialog`, `addToTestRun` server
 * action, /api/test-results/import, and the Testmo workers — delegate here
 * so the WHERE clause lives in exactly one place. When the project flag is
 * `false`, every helper short-circuits to a no-op (mirrors the shape of
 * `lib/services/reviewGate.ts`).
 *
 * The matching SQL filter for "case is in NOT_STARTED" is
 * `state.workflowType = 'NOT_STARTED'` — the Workflows row's discriminator,
 * not a state-name lookup. This is the canonical query per
 * `schema.zmodel:1049-1052`.
 */

import { WorkflowType } from "~/zenstack/models";
import type { RepositoryCasesWhereInput } from "~/zenstack/input";
import type { TxClient } from "~/lib/zenstack";

type AnyTx = TxClient | { repositoryCases: any; projects: any };

interface ProjectFlagProbe {
  excludeNotStartedFromRuns: boolean;
}

/**
 * Cheap one-row read of just the eligibility flag for a project. Exposed for
 * batch loops (e.g. import workers) that want to amortize the lookup across a
 * whole run rather than re-fetch the project on every row.
 */
export async function getProjectExclusionFlag(
  tx: AnyTx,
  projectId: number
): Promise<boolean> {
  const project = await (tx as any).projects.findUnique({
    where: { id: projectId },
    select: { excludeNotStartedFromRuns: true },
  });
  return !!project?.excludeNotStartedFromRuns;
}

/**
 * Single-case eligibility check. Returns `true` when the case may be added
 * to a run on this project, `false` when the project's exclusion flag is on
 * AND the case's workflow state is NOT_STARTED. Missing project = `true`
 * (defensive — don't block writes on a stale projectId).
 */
export async function isCaseEligibleForRun(
  tx: AnyTx,
  args: { projectId: number; repositoryCaseId: number }
): Promise<boolean> {
  const flagOn = await getProjectExclusionFlag(tx, args.projectId);
  if (!flagOn) return true;
  const c = await (tx as any).repositoryCases.findUnique({
    where: { id: args.repositoryCaseId },
    select: { state: { select: { workflowType: true } } },
  });
  // Case not found is "let the caller's own validation fire" — we don't want
  // to mask a legit "case missing" error as an eligibility refusal.
  if (!c) return true;
  return c.state?.workflowType !== WorkflowType.NOT_STARTED;
}

/**
 * Bulk variant — returns the subset of `repositoryCaseIds` that pass the
 * eligibility check. Order is preserved relative to the input. When the
 * project flag is off, returns the input array verbatim (no DB hit beyond
 * the project probe). Empty input returns empty.
 */
export async function filterEligibleCaseIds(
  tx: AnyTx,
  args: { projectId: number; repositoryCaseIds: number[] }
): Promise<number[]> {
  if (!args.repositoryCaseIds.length) return [];
  const flagOn = await getProjectExclusionFlag(tx, args.projectId);
  if (!flagOn) return args.repositoryCaseIds;

  const eligibleIds = new Set<number>(
    (
      await (tx as any).repositoryCases.findMany({
        where: {
          id: { in: args.repositoryCaseIds },
          projectId: args.projectId,
          isDeleted: false,
          state: { workflowType: { not: WorkflowType.NOT_STARTED } },
        },
        select: { id: true },
      })
    ).map((c: { id: number }) => c.id)
  );

  return args.repositoryCaseIds.filter((id) => eligibleIds.has(id));
}

/**
 * Prisma WHERE-fragment for `RepositoryCases` queries that should hide
 * NOT_STARTED-state cases when the caller already knows the project's
 * exclusion flag. Use this on case-picker tree queries where surface-level
 * scoping matters (so excluded cases never paint in the UI). Returns `{}`
 * when the flag is off so it can be spread into an existing where clause
 * unconditionally.
 *
 * The caller is responsible for reading `project.excludeNotStartedFromRuns`
 * — this fragment is purely syntactic to avoid an extra DB round-trip when
 * the project record is already in hand.
 */
export function buildEligibleCasesWhere(args: {
  project: ProjectFlagProbe | null | undefined;
}): RepositoryCasesWhereInput {
  if (!args.project?.excludeNotStartedFromRuns) return {};
  return {
    state: { workflowType: { not: WorkflowType.NOT_STARTED } },
  };
}

/**
 * Soft-deletes UNEXECUTED `TestRunCases` rows for a case that just transitioned
 * into a NOT_STARTED workflow state, when the case's project has
 * `excludeNotStartedFromRuns` on. Executed run-cases (any row with at least one
 * `TestRunResults`) are left in place so the recorded outcome remains visible;
 * the existing edit-window machinery locks them. Only open runs (`testRun.isCompleted = false`)
 * are touched.
 *
 * Centralized here so the auto-API route (which bypasses `lib/prisma.ts`'s
 * `$extends` hooks) and any future direct-Prisma callers share the exact same
 * soft-delete WHERE shape.
 *
 * Returns the count of run-cases soft-deleted, or `0` if no work was needed.
 * Safe to call even when the flag is off, the new state isn't NOT_STARTED, or
 * the case has no open-run rows — every guard exits with `0` before touching
 * `TestRunCases`.
 */
export async function softDeleteUnexecutedRunCasesForDraftRevert(
  tx: AnyTx,
  args: { projectId: number; repositoryCaseId: number; newStateId: number }
): Promise<number> {
  const flagOn = await getProjectExclusionFlag(tx, args.projectId);
  if (!flagOn) return 0;
  const newState = await (tx as any).workflows.findUnique({
    where: { id: args.newStateId },
    select: { workflowType: true },
  });
  if (newState?.workflowType !== WorkflowType.NOT_STARTED) return 0;
  const result = await (tx as any).testRunCases.updateMany({
    where: {
      repositoryCaseId: args.repositoryCaseId,
      isDeleted: false,
      testRun: { isCompleted: false },
      results: { none: {} },
    },
    data: { isDeleted: true },
  });
  return result.count ?? 0;
}
