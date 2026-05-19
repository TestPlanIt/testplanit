import type {
  CardinalityBand,
  CardinalityThresholds,
  PerCaseContribution,
  PreflightResult,
} from "~/lib/types/iterationCardinality";

/**
 * Iteration cardinality math.
 *
 * Pure functions only — no Prisma, no I/O. The only impure surface is
 * `readCardinalityThresholds`, which reads `process.env`.
 *
 * Used by:
 *   - POST /api/test-runs/preflight-cardinality (live count for the modal)
 *   - POST /api/test-runs/[runId]/generate-iterations (mid-flight count)
 *   - the BullMQ iteration-generation worker (sanity check before fan-out)
 *   - the AddTestRunModal preflight chip (via the API endpoints above)
 */

/**
 * Default thresholds. Match the placeholder values in `.env.example`.
 *
 * The constants live here (not the type module) so callers can reference the
 * defaults without importing process.env.
 */
export const DEFAULT_CARDINALITY_THRESHOLDS: CardinalityThresholds = {
  hardCap: 5000,
  softCap: 1000,
  asyncCap: 500,
};

/**
 * Reads the three iteration-cardinality thresholds from the environment.
 * Falls back to the defaults if a variable is unset, empty, or non-numeric.
 *
 * Invariant: hardCap >= softCap >= asyncCap. The function tolerates inverted
 * configurations (it does not throw or sort) — administrators are responsible
 * for sane values; classification simply behaves as written if the order is
 * wrong (which is also the safest behavior: misconfiguration produces visible
 * UI artifacts rather than silent fan-out drift).
 */
export function readCardinalityThresholds(): CardinalityThresholds {
  const parse = (raw: string | undefined, fallback: number): number => {
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    hardCap: parse(
      process.env.PARAMETERIZED_RUN_HARD_CAP,
      DEFAULT_CARDINALITY_THRESHOLDS.hardCap
    ),
    softCap: parse(
      process.env.PARAMETERIZED_RUN_SOFT_CAP,
      DEFAULT_CARDINALITY_THRESHOLDS.softCap
    ),
    asyncCap: parse(
      process.env.PARAMETERIZED_RUN_ASYNC_CAP,
      DEFAULT_CARDINALITY_THRESHOLDS.asyncCap
    ),
  };
}

/**
 * Classify a total iteration count against three thresholds.
 *
 * Boundary rules (locked):
 *   - total > hardCap         → "hardRefuse"
 *   - softCap < total ≤ hardCap → "softConfirm"
 *   - asyncCap < total ≤ softCap → "async"
 *   - total ≤ asyncCap        → "sync"   (includes zero)
 */
export function classifyBand(
  total: number,
  thresholds: CardinalityThresholds
): CardinalityBand {
  if (total > thresholds.hardCap) return "hardRefuse";
  if (total > thresholds.softCap) return "softConfirm";
  if (total > thresholds.asyncCap) return "async";
  return "sync";
}

/**
 * Per-case input shape for `computePreflight`. Callers (the API route)
 * resolve the case + dataset row count from the database; this function
 * only does the math.
 *
 * `rowCount`: row count from the owner dataset (0 if no owner).
 * `assignedRowCount`: row count from the pinned shared-dataset version (0
 *   if no assignment OR if the case has an owner dataset that wins per
 *   the owner-wins semantic). The case's effective row count is
 *   `Math.max(rowCount, assignedRowCount)`; both being non-zero is unusual
 *   but possible (a case has both an owner dataset and a shared
 *   assignment) — owner wins for iteration, so the API route MUST set
 *   `assignedRowCount` to 0 in that case before passing the input here.
 *   `computePreflight` itself uses `Math.max` defensively.
 */
export interface PreflightCaseInput {
  caseId: number;
  caseTitle: string;
  /** True iff RepositoryCases.hasParameters is true AND a dataset is attached */
  hasParameters: boolean;
  /** Number of non-soft-deleted dataset rows on the owner dataset (0 if none) */
  rowCount: number;
  /**
   * Number of rows on the resolved shared-dataset version (0 if no shared
   * assignment OR the route already zeroed it for owner-wins).
   */
  assignedRowCount?: number;
}

/**
 * Compute the full `PreflightResult` for a set of case inputs and a config
 * fan-out factor.
 *
 * Math:
 *   - For each parameterized case: `iterations =
 *     max(rowCount, assignedRowCount ?? 0) × configCount`. Shared datasets
 *     contribute via `assignedRowCount`; the API route is responsible for
 *     applying the owner-wins zeroing before calling.
 *   - For each non-parameterized case: `iterations = 0` (still gets a
 *     TestRunCases row but no iteration fan-out)
 *   - `configCount = max(1, configIds.length)` — selecting zero configs still
 *     creates exactly one TestRunCases row per case (configId = null), so the
 *     iteration multiplier collapses to 1, not 0.
 *
 * Cases with `hasParameters: true` but no row source contribute 0
 * iterations and ARE included in `perCase` so the UI can show "0 rows yet
 * — add data" messaging if desired. Non-parameterized cases are omitted
 * from `perCase`.
 */
export function computePreflight(
  cases: PreflightCaseInput[],
  configCount: number,
  thresholds: CardinalityThresholds
): PreflightResult {
  const fanOut = Math.max(1, configCount);
  const perCase: PerCaseContribution[] = [];
  let total = 0;
  for (const c of cases) {
    if (!c.hasParameters) continue;
    const effectiveRowCount = Math.max(c.rowCount, c.assignedRowCount ?? 0);
    const iterations = effectiveRowCount * fanOut;
    perCase.push({
      caseId: c.caseId,
      caseTitle: c.caseTitle,
      rowCount: effectiveRowCount,
      iterations,
    });
    total += iterations;
  }
  // Sort biggest contributors first so the hard-refuse dialog highlights
  // the cases most responsible for the cardinality blow-up.
  perCase.sort((a, b) => b.iterations - a.iterations);
  return {
    total,
    perCase,
    thresholds,
    classification: classifyBand(total, thresholds),
  };
}
