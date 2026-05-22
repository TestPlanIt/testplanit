// Adaptive existing-cases context budget for the outline phase.
//
// Mirrors the duplicate-detection / auto-tag pattern: start small, grow on
// success, shrink + retry on timeout. Keeps the prompt small enough to fit
// the LLM integration's request timeout while giving the LLM as much dedup
// signal as the model can chew through quickly.
//
// State is in-memory only — lost on restart. Test case generation has always
// rediscovered its working sizes from scratch.

export const OUTLINE_CTX_INITIAL_BUDGET = 1500;
export const OUTLINE_CTX_MAX_BUDGET = 8000;
export const OUTLINE_CTX_MIN_USEFUL = 100;
export const OUTLINE_CTX_GROWTH_FACTOR = 1.5;
export const OUTLINE_RETRY_MAX_DEPTH = 3;

// integrationId -> last budget that successfully completed an outline call.
const learnedOutlineCtxBudget = new Map<number, number>();

/**
 * Compute the budget the next outline call should start with for the given
 * integration. Grows the last-known-good budget by OUTLINE_CTX_GROWTH_FACTOR,
 * capped at OUTLINE_CTX_MAX_BUDGET. Never returns below
 * OUTLINE_CTX_INITIAL_BUDGET so a single bad run doesn't permanently lock the
 * integration into a tiny budget.
 */
export function getStartingBudget(integrationId: number): number {
  const stored = learnedOutlineCtxBudget.get(integrationId);
  if (stored === undefined) return OUTLINE_CTX_INITIAL_BUDGET;
  const grown = Math.max(
    Math.ceil(stored * OUTLINE_CTX_GROWTH_FACTOR),
    OUTLINE_CTX_INITIAL_BUDGET
  );
  return Math.min(grown, OUTLINE_CTX_MAX_BUDGET);
}

/**
 * Record the budget that produced a successful outline call so future calls
 * for the same integration start from a sane size.
 */
export function recordWorkingBudget(
  integrationId: number,
  budget: number
): void {
  learnedOutlineCtxBudget.set(integrationId, budget);
}

/** Test-only: reset all learned state. */
export function _resetLearnedBudgets(): void {
  learnedOutlineCtxBudget.clear();
}

export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "TIMEOUT") return true;
  return typeof e.message === "string" && /timeout/i.test(e.message);
}
