/**
 * Iteration cardinality types.
 *
 * The TestRun creation flow refuses, soft-confirms, async-routes, or sync-runs
 * iteration fan-out based on three thresholds (hardCap > softCap > asyncCap)
 * configured via environment variables. These types describe the contract
 * shared by the preflight API endpoint, the generate-iterations API endpoint,
 * the BullMQ worker, and the AddTestRunModal client wiring.
 *
 * Pure data — no Prisma, no React, no I/O. Safe to import from anywhere.
 */

/**
 * Cardinality classification band.
 *
 * - "sync"       — total <= asyncCap; run inline in a single transaction.
 * - "async"      — asyncCap < total <= softCap; route to BullMQ worker.
 * - "softConfirm" — softCap < total <= hardCap; client must confirm before
 *                  enqueueing; server will still queue if asked.
 * - "hardRefuse" — total > hardCap; reject with 422; do NOT enqueue.
 */
export type CardinalityBand = "sync" | "async" | "softConfirm" | "hardRefuse";

/**
 * Per-case contribution to the total iteration count.
 *
 * One entry per parameterized RepositoryCase that participates in the run.
 * Non-parameterized cases contribute zero iterations and are omitted from
 * this list (the chip says "Will create N iterations", and a non-parameterized
 * case creates zero iterations even though it still gets a TestRunCases row).
 */
export interface PerCaseContribution {
  /** RepositoryCases.id */
  caseId: number;
  /** RepositoryCases.name (de-redacted, for display) */
  caseTitle: string;
  /** Number of dataset rows attached to this case */
  rowCount: number;
  /**
   * Number of iterations this case will materialize for the run.
   * Equal to rowCount × configCount; non-parameterized cases contribute 0.
   */
  iterations: number;
}

/**
 * Result of the preflight calculation.
 *
 * Returned by:
 *   - POST /api/test-runs/preflight-cardinality (live count)
 *   - POST /api/test-runs/[runId]/generate-iterations (mid-flight count
 *     against an already-created run; refuse path returns this shape).
 */
export interface PreflightResult {
  /** Sum of `iterations` across all entries in `perCase` */
  total: number;
  /** Per-case breakdown; empty when no parameterized cases were selected */
  perCase: PerCaseContribution[];
  /** Snapshot of the env-var thresholds used to classify */
  thresholds: CardinalityThresholds;
  /** Pre-computed band for `total` against `thresholds` */
  classification: CardinalityBand;
}

/**
 * Cardinality thresholds. Snapshotted at the moment of the preflight call so
 * the UI sees exactly the same numbers the server used to classify.
 */
export interface CardinalityThresholds {
  /** Refuse > hardCap (default 5000) */
  hardCap: number;
  /** Soft-confirm > softCap (default 1000) */
  softCap: number;
  /** Async fan-out > asyncCap (default 500) */
  asyncCap: number;
}
