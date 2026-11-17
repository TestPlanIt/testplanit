import type { TxClient } from "~/lib/zenstack";

import { resolveEffectiveWindowSeconds } from "~/lib/services/editWindow";

/**
 * AppConfig key holding the SYSTEM revert-window policy (in seconds). Same
 * three-state shape as `edit_results_duration`:
 *   - `null` (no row) → no system policy; the project decides, and an
 *     unconfigured project falls back to REVERT_DECISION_WINDOW_SECONDS_DEFAULT.
 *   - `0`            → reverting disabled everywhere; projects cannot override.
 *   - `N > 0`        → maximum window; projects may tighten down to [0, N].
 */
export const REVERT_DECISION_DURATION_KEY = "revert_decision_duration";

/**
 * Window applied when neither the system policy nor the project override is
 * set. The result-edit resolver treats "nothing configured" as unrestricted,
 * which is wrong here: a decision reverted a year later is confusing rather
 * than useful, so an unconfigured install still gets a bound. Set the
 * AppConfig row to a positive value to raise or lower it, or to 0 to turn
 * reverting off entirely.
 */
export const REVERT_DECISION_WINDOW_SECONDS_DEFAULT = 24 * 60 * 60;

/**
 * Reads the system revert-window policy from AppConfig. Stored as a JSON
 * number; a numeric string is accepted defensively, matching
 * `readEditResultsDurationSeconds`. Returns `null` when unconfigured.
 */
export async function readRevertDecisionDurationSeconds(
  client: Pick<TxClient, "appConfig">
): Promise<number | null> {
  const row = await client.appConfig.findUnique({
    where: { key: REVERT_DECISION_DURATION_KEY },
  });
  if (!row) return null;

  const value = row.value as unknown;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

/**
 * Resolve the effective revert window (seconds) for one project.
 *
 * Delegates the system-ceiling-vs-project-override arithmetic to
 * `resolveEffectiveWindowSeconds` (projects may only tighten, never loosen),
 * then substitutes the default for the "nothing configured anywhere" case.
 *
 *   - `0` → reverting disabled.
 *   - `N` → revertable for N seconds after `decidedAt`.
 *
 * Never returns `null`: unlike result edits, there is always a bound.
 */
export function resolveRevertWindowSeconds(
  systemSeconds: number | null,
  projectSeconds: number | null
): number {
  const effective = resolveEffectiveWindowSeconds(
    systemSeconds,
    projectSeconds
  );
  return effective === null
    ? REVERT_DECISION_WINDOW_SECONDS_DEFAULT
    : effective;
}

/**
 * True when a decision made at `decidedAt` is still inside the window.
 * Callers handle the system-admin bypass before reaching this helper.
 */
export function isWithinRevertWindow(
  decidedAt: Date,
  windowSeconds: number
): boolean {
  if (windowSeconds <= 0) return false;
  const ageSeconds = (Date.now() - decidedAt.getTime()) / 1000;
  return ageSeconds <= windowSeconds;
}
