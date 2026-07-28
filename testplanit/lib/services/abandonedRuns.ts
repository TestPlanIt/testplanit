import type { TxClient } from "~/lib/zenstack";

/**
 * AppConfig key holding the SYSTEM abandoned automated-run idle threshold,
 * in minutes:
 *   - missing row / `0` → sweeping disabled (the upgrade-safe default; the
 *     hourly sweeper is a no-op until an admin turns it on).
 *   - `N > 0`           → an incomplete automated run whose newest imported
 *     result (or, with no results, its creation) is older than N minutes is
 *     considered abandoned and auto-closed.
 *
 * Projects can override via `Projects.abandonedRunIdleMinutes` (null =
 * inherit, 0 = disabled for that project, N = project-specific threshold).
 */
export const ABANDONED_RUN_IDLE_MINUTES_KEY = "abandoned_run_idle_minutes";

/**
 * Smallest idle threshold the UI accepts, matching the sweep cadence
 * (every 15 minutes) so a configured threshold is never finer than the
 * sweep can honor — with both at 15, a run is closed at most ~30 minutes
 * after its last result rather than promising precision the scheduler
 * can't deliver.
 */
export const ABANDONED_RUN_MIN_IDLE_MINUTES = 15;

/**
 * Reads the system abandoned-run idle threshold (minutes) from AppConfig.
 * The value is stored as a JSON number; a numeric string is accepted
 * defensively. Missing row or any invalid/negative value → 0 (disabled) so a
 * malformed row can never start closing runs.
 */
export async function readSystemAbandonedRunIdleMinutes(
  client: Pick<TxClient, "appConfig">
): Promise<number> {
  const row = await client.appConfig.findUnique({
    where: { key: ABANDONED_RUN_IDLE_MINUTES_KEY },
  });
  if (!row) return 0;

  const value = row.value as unknown;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
  ) {
    return Math.floor(Number(value));
  }
  return 0;
}

/**
 * Resolves the effective idle threshold (minutes) for one project.
 *
 *   - project `null` → inherit the system value.
 *   - project `0`    → sweeping disabled for this project.
 *   - project `N`    → project-specific threshold (may loosen OR tighten the
 *     system value — unlike the result edit window this is an operational
 *     knob, not a security ceiling).
 *
 * A return of `0` means "do not sweep".
 */
export function resolveEffectiveIdleMinutes(
  systemMinutes: number,
  projectMinutes: number | null
): number {
  if (projectMinutes === null) return systemMinutes;
  return projectMinutes >= 0 ? projectMinutes : 0;
}

/**
 * Picks the RUNS workflow state an abandoned run in `projectId` is moved
 * into. Workflow rows are per-install and assigned per-project, so nothing
 * here may reference a state by name or hardcoded id:
 *
 *   1. the project's configured `abandonedRunStateId`, provided that state is
 *      still enabled, not deleted, RUNS-scoped, and assigned to the project
 *      (an admin can unassign or disable a workflow after configuring it);
 *   2. else the lowest-`order` enabled DONE workflow assigned to the project
 *      — the same fallback milestone auto-completion uses
 *      (`app/actions/milestoneActions.ts`);
 *   3. else `null` — the caller flips `isCompleted` only and leaves
 *      `stateId` alone.
 */
export async function resolveAbandonedRunTargetStateId(
  client: Pick<TxClient, "workflows">,
  projectId: number,
  configuredStateId: number | null
): Promise<number | null> {
  if (configuredStateId !== null) {
    const configured = await client.workflows.findFirst({
      where: {
        id: configuredStateId,
        scope: "RUNS",
        isEnabled: true,
        isDeleted: false,
        projects: { some: { projectId } },
      },
      select: { id: true },
    });
    if (configured) return configured.id;
  }

  const doneRunWorkflow = await client.workflows.findFirst({
    where: {
      scope: "RUNS",
      workflowType: "DONE",
      isEnabled: true,
      isDeleted: false,
      projects: { some: { projectId } },
    },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  return doneRunWorkflow?.id ?? null;
}
