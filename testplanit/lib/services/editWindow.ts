import type { TxClient } from "~/lib/zenstack";

/**
 * AppConfig key holding the SYSTEM edit-window policy (in seconds):
 *   - `null` (no row) → no policy; projects decide freely (unrestricted unless
 *     a project sets its own).
 *   - `0`            → editing disabled everywhere; projects cannot override.
 *   - `N > 0`        → maximum window; projects may tighten down to [0, N].
 */
const EDIT_RESULTS_DURATION_KEY = "edit_results_duration";

/**
 * Thrown when a non-admin attempts to edit a manual result after the resolved
 * edit window has closed (or when editing is disabled). Caught at the
 * model-route chokepoint and surfaced as a structured 403.
 */
export class EditWindowExpiredError extends Error {
  readonly code = "EDIT_WINDOW_EXPIRED" as const;
  constructor(message = "The edit window for this result has closed") {
    super(message);
    this.name = "EditWindowExpiredError";
  }
}

export function isEditWindowExpiredError(
  error: unknown
): error is EditWindowExpiredError {
  return (
    error instanceof EditWindowExpiredError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "EDIT_WINDOW_EXPIRED")
  );
}

/**
 * Reads the system edit-window policy from AppConfig. The value is stored as a
 * JSON number (matching the client read in `TestResultHistory`); a numeric
 * string is accepted defensively. Returns `null` when unconfigured.
 */
export async function readEditResultsDurationSeconds(
  client: Pick<TxClient, "appConfig">
): Promise<number | null> {
  const row = await client.appConfig.findUnique({
    where: { key: EDIT_RESULTS_DURATION_KEY },
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
 * Resolves the effective edit window (seconds) from the system ceiling and a
 * project override. The system value is a ceiling: projects can only tighten,
 * never loosen.
 *
 *   - return `null` → unrestricted (no time limit).
 *   - return `0`    → editing disabled.
 *   - return `N`    → editable for N seconds after `executedAt`.
 */
export function resolveEffectiveWindowSeconds(
  systemSeconds: number | null,
  projectSeconds: number | null
): number | null {
  if (systemSeconds === 0) return 0; // disabled everywhere; no override
  if (systemSeconds === null) return projectSeconds; // no policy → project's call
  // systemSeconds > 0 → overridable max ceiling.
  if (projectSeconds === null) return systemSeconds; // inherit the max
  return Math.min(projectSeconds, systemSeconds); // tighten (0 stays 0)
}

/**
 * Server-side enforcement of the result edit window.
 *
 * System admins (`access === "ADMIN"`) always pass — they retain edit
 * capability by design (a small, fully audited footprint). For everyone else
 * the effective window is resolved from the system policy and the result's
 * project override; the edit is rejected when editing is disabled or the
 * window has elapsed since the result was recorded. TestRunResults rows are
 * manual results by definition (automated results live in JUnitTestResult), so
 * no source check is needed.
 *
 * A missing result row is left for the downstream handler to surface, so the
 * guard never masks a 404 as a 403.
 */
export async function assertResultEditWindowOpen(
  client: Pick<TxClient, "appConfig" | "testRunResults">,
  resultId: number,
  userAccess: string | null | undefined
): Promise<void> {
  if (userAccess === "ADMIN") return;

  const systemSeconds = await readEditResultsDurationSeconds(client);

  const result = await client.testRunResults.findUnique({
    where: { id: resultId },
    select: {
      executedAt: true,
      testRun: {
        select: { project: { select: { editResultsDurationSeconds: true } } },
      },
    },
  });
  if (!result) return;

  const projectSeconds =
    result.testRun?.project?.editResultsDurationSeconds ?? null;
  const effective = resolveEffectiveWindowSeconds(
    systemSeconds,
    projectSeconds
  );

  if (effective === null) return; // unrestricted
  if (effective === 0) {
    throw new EditWindowExpiredError("In-place result edits are disabled");
  }

  const ageSeconds =
    (Date.now() - new Date(result.executedAt).getTime()) / 1000;
  if (ageSeconds > effective) {
    throw new EditWindowExpiredError();
  }
}
