/**
 * Shared TypeScript contracts for the Matrix view.
 *
 * Pure types only — no Prisma imports, no IO. Safe to bundle into client
 * code. The dedicated Matrix page and the report-builder preset both
 * consume these shapes; downstream tasks (cell-count route, aggregate
 * route, CSV export, MatrixGrid component) implement against this module.
 *
 * Cell key convention: every cell is keyed by `${caseId}|${configId}|${rowIndex}`.
 * Use the `cellKey` helper exported here — never inline the template
 * string. The configId sentinel `0` represents "no configuration"; runs
 * with TestRuns.configId IS NULL collapse into a single column rendered
 * with `configName === "(none)"`.
 *
 * PARAM-07: non-parameterized cases get a single synthetic sub-row
 * `{ index: 0, label: "(no parameters)", values: {} }` so the visual
 * grid always has at least one cell per case×config.
 */

/**
 * Filter shape parsed by the API route's Zod schema. Every filter is
 * optional; an empty/missing array means "no filter on this dimension".
 */
export interface MatrixFilters {
  statusIds?: number[];
  configIds?: number[];
  datasetIds?: number[];
  /** ISO-8601 datetime; bounds TestRuns.createdAt (NOT iteration completedAt). */
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Single sub-row on the parameter axis. `values` is the redacted,
 * parameter-keyed value map (Phase 4's `materializeForOneCase` already
 * mapped raw column names to parameter names; the matrix reads as-is).
 *
 * For non-parameterized cases the synthetic entry is
 * `{ index: 0, label: "(no parameters)", values: {} }`.
 */
export interface ParamRowAxisItem {
  index: number;
  label: string | null;
  values: Record<string, unknown>;
}

/**
 * One entry per case in the rendered grid. The grid visually expands
 * each `CaseAxisItem` into N sub-rows — one per `paramRows[i]`.
 *
 * `source` matches the `RepositoryCaseSource` enum (kept as a string here
 * to keep this module Prisma-free); `automated` mirrors `RepositoryCases.automated`.
 * Both feed `CaseDisplay` so the rail icon picks the
 * right glyph (manual vs. automated).
 */
export interface CaseAxisItem {
  caseId: number;
  caseName: string;
  hasParameters: boolean;
  source: string;
  automated: boolean;
  paramRows: ParamRowAxisItem[];
  parameters?: Array<{ name: string; type: string; sensitive: boolean }>;
}

/**
 * One entry per configuration column. `configId === 0` is the sentinel
 * for "runs without a configuration" (TestRuns.configId IS NULL);
 * `configName === "(none)"` for the sentinel.
 */
export interface ConfigAxisItem {
  configId: number;
  configName: string;
}

/**
 * Per-iteration metadata carried inside every cell so the popover
 * drill-down can render the run / iteration list without a second
 * round-trip.
 */
export interface IterationSummary {
  id: number;
  /**
   * Zero-indexed position of this iteration within its TestRunCase's
   * iteration list. The run page's `?iteration=N` URL param is 1-indexed
   * and matches the visible ordinal in the iteration sidebar — so callers
   * should pass `rowIndex + 1` when building a deep link, NOT `id`.
   */
  rowIndex: number;
  label: string | null;
  statusId: number | null;
  runId: number;
  runName: string;
  runIsCompleted: boolean;
  /**
   * ISO-8601 string when this iteration was completed, or `null` when
   * the iteration has been touched but not yet completed (e.g. status
   * was overridden but no completion event recorded). Used by the
   * matrix cell popover to answer "when was this run executed?"
   * without requiring a click into the run page.
   */
  completedAt: string | null;
}

/**
 * Aggregated cell payload for one (case, config, paramRow) tuple.
 *
 * `worstOfStatusId` is computed by `computeWorstOfStatus` from
 * `lib/services/iterationRollup.ts` — never reimplemented in SQL. The
 * SQL extracts count tuples and `iteration_ids[]`; the JS layer feeds
 * them through the rollup helper.
 *
 * `mostRecentCompletedAt` is the ISO-8601 string of the highest
 * `iter."completedAt"` across the cell's iterations, or `null` when
 * every iteration in the cell is still in-flight (completedAt === null).
 * The CSV "Recorded at" column reads this directly; the field is part
 * of the Wave 1 contract — never patched in later.
 *
 * `iterations` carries one entry per iteration in the cell; powers the
 * popover drill-down list.
 */
export interface CellSummary {
  caseId: number;
  configId: number;
  rowIndex: number;
  iterationCount: number;
  pass: number;
  fail: number;
  notRun: number;
  other: number;
  worstOfStatusId: number | null;
  mostRecentCompletedAt: string | null;
  iterations: IterationSummary[];
}

/**
 * Project-wide status palette. Keyed by `Status.id`. The aggregation
 * response includes this so `MatrixCell` can render the right pip color
 * without a second status fetch.
 */
export interface StatusMapEntry {
  id: number;
  name: string;
  isSuccess: boolean;
  isFailure: boolean;
  isCompleted: boolean;
  order: number;
  colorValue: string;
}

/**
 * The full matrix payload. `cells` is keyed by `cellKey(caseId, configId, rowIndex)`
 * for O(1) lookup at virtualization render time.
 *
 * `cellCount` is the per-case sub-axis math
 * (`Σ paramRows[c].length × configCount`), NOT the global axis math
 * (`caseCount × maxRows × configCount`).
 */
export interface AxesShape {
  caseAxis: CaseAxisItem[];
  configAxis: ConfigAxisItem[];
  cells: Map<string, CellSummary>;
  cellCount: number;
  statusMap: Record<number, StatusMapEntry>;
}

/**
 * Result of the cell-count preflight. The API route at
 * `/api/projects/[projectId]/matrix/cell-count` returns this shape
 * directly. When `willRefuse === true` the aggregate route returns 422
 * with the same body before running any aggregation SQL.
 */
export interface MatrixCellCountResult {
  cellCount: number;
  willRefuse: boolean;
  threshold: 50000;
  axisCounts: {
    caseCount: number;
    configCount: number;
    perCaseMaxIterations: Array<{ caseId: number; maxIterations: number }>;
  };
}

/**
 * Defense-in-depth error: thrown by `runMatrixAggregation` when called
 * without a separate preflight and the requested cells exceed the cap.
 * The route layer catches this and returns 422 with `result` as the
 * response body.
 */
export class MatrixCellCapExceededError extends Error {
  public readonly result: MatrixCellCountResult;
  constructor(result: MatrixCellCountResult) {
    super(
      `Matrix cell count ${result.cellCount} exceeds threshold ${result.threshold}`
    );
    this.name = "MatrixCellCapExceededError";
    this.result = result;
  }
}

/**
 * Canonical cell key. Every Map insertion + lookup MUST go through this
 * helper to prevent typo drift across consumers.
 */
export function cellKey(
  caseId: number,
  configId: number,
  rowIndex: number
): string {
  return `${caseId}|${configId}|${rowIndex}`;
}
