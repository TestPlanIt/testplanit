/**
 * DB-backed matrix aggregator.
 *
 * Single `$queryRaw` aggregation against the iterations table, plus
 * lightweight axis hydration queries and a project-wide status fetch.
 * The worst-of rollup per cell is delegated to
 * `computeWorstOfStatus` from `~/lib/services/iterationRollup` — never
 * reimplemented in SQL. Sensitive parameter values are redacted via
 * `redactValues` from `~/lib/services/parameterRedaction` before the
 * payload leaves this helper, so downstream consumers (CSV export,
 * popover, report-builder preset) do not need to redact again.
 *
 * SECURITY: this helper bypasses ZenStack policies (raw SQL). The
 * caller MUST gate by project via the enhanced client BEFORE invoking
 * `runMatrixAggregation`. The cross-project denial in the helper
 * integration test verifies the WHERE clause correctly bounds by
 * `projectId`, but it is NOT a substitute for the route-layer
 * project-read-gate.
 */

import { type RawBuilder, sql } from "kysely";

import type { DbClient, TxClient } from "~/lib/zenstack";

import {
  computeWorstOfStatus,
  type RollupStatus,
} from "~/lib/services/iterationRollup";

/**
 * Accept either the singleton client or a `TxClient` so
 * callers (and live-DB integration tests) can pass `tx` to read inside
 * a rolled-back transaction.
 */
type DbLike = DbClient | TxClient;
import {
  redactValues,
  type ParameterSchemaEntry,
} from "~/lib/services/parameterRedaction";

import { buildAxes } from "./buildAxes";
import { runCellCountPreflight } from "./matrixCellCount";
import type {
  AxesShape,
  CaseAxisItem,
  CellSummary,
  ConfigAxisItem,
  IterationSummary,
  MatrixFilters,
  ParamRowAxisItem,
  StatusMapEntry,
} from "./types";
import { MatrixCellCapExceededError } from "./types";

// Re-export so callers can import the error from the same module that
// throws it.
export { MatrixCellCapExceededError } from "./types";

// ---------------------------------------------------------------------------
// Internal row shapes (Postgres column-name conventions; mapped to the
// CellSummary contract in the JS layer).
// ---------------------------------------------------------------------------

interface CaseRow {
  id: number;
  name: string;
  has_parameters: boolean;
  source: string;
  automated: boolean;
  parameters: unknown; // TestCaseParameter[] selected as a json aggregate
}

interface ConfigRow {
  config_id: number;
  config_name: string;
}

interface SnapshotRow {
  case_id: number;
  rows_json: unknown;
  parameters_json: unknown;
  created_at: Date;
}

interface IterationJsonShape {
  id: number;
  rowIndex: number;
  label: string | null;
  statusId: number | null;
  runId: number;
  runName: string;
  runIsCompleted: boolean;
  completedAt: string | null;
}

interface AggregateRow {
  case_id: number;
  config_id: number;
  row_index: number;
  iteration_count: bigint;
  pass_count: bigint;
  fail_count: bigint;
  notrun_count: bigint;
  other_count: bigint;
  most_recent_completed_at: Date | null;
  iteration_ids: number[] | null;
  iterations_json: IterationJsonShape[] | null;
}

interface SnapshotRowShape {
  rowIndex: number;
  label: string | null;
  valuesJson: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Filter predicate composition. Mirrors matrixCellCount but the
// aggregation needs filter scope to apply to the iteration row directly
// (statusIds), not via EXISTS — because each row of the aggregate is
// already grouped by iteration.
// ---------------------------------------------------------------------------

interface FilterFragments {
  /** Predicates that bind the run / run-case scope. */
  scopeFragment: RawBuilder<unknown>;
  /** Predicate that bounds the iteration row directly (statusIds). */
  iterationFragment: RawBuilder<unknown>;
}

function buildFilterFragments(filters: MatrixFilters): FilterFragments {
  const scope: RawBuilder<unknown>[] = [];

  if (filters.configIds && filters.configIds.length > 0) {
    scope.push(
      sql`AND COALESCE(tr."configId", 0) = ANY(${filters.configIds}::int[])`
    );
  }

  if (filters.dateFrom) {
    scope.push(sql`AND tr."createdAt" >= ${new Date(filters.dateFrom)}`);
  }
  if (filters.dateTo) {
    scope.push(sql`AND tr."createdAt" <= ${new Date(filters.dateTo)}`);
  }

  if (filters.datasetIds && filters.datasetIds.length > 0) {
    scope.push(sql`AND EXISTS (
      SELECT 1 FROM "TestRunCaseDataSetSnapshot" trcs
      WHERE trcs."testRunCaseId" = trc.id
        AND trcs."isDeleted" = false
        AND trcs."sourceDataSetId" = ANY(${filters.datasetIds}::int[])
    )`);
  }

  const scopeFragment =
    scope.length === 0 ? sql`` : sql`${sql.join(scope, sql` `)}`;

  const iterationFragment =
    filters.statusIds && filters.statusIds.length > 0
      ? sql`AND iter."statusId" = ANY(${filters.statusIds}::int[])`
      : sql``;

  return { scopeFragment, iterationFragment };
}

// ---------------------------------------------------------------------------
// Axis / payload hydration helpers.
// ---------------------------------------------------------------------------

async function fetchCaseAxis(
  db: DbLike,
  projectId: number,
  scopeFragment: RawBuilder<unknown>
): Promise<CaseRow[]> {
  const result = await sql<CaseRow>`
    SELECT
      rc.id,
      rc.name,
      rc."hasParameters" AS has_parameters,
      rc.source::text AS source,
      rc.automated,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'name', p.name,
              'type', p.type,
              'sensitive', p.sensitive,
              'order', p."order"
            ) ORDER BY p."order"
          )
          FROM "TestCaseParameter" p
          WHERE p."testCaseId" = rc.id AND p."isDeleted" = false
        ),
        '[]'::json
      ) AS parameters
    FROM "RepositoryCases" rc
    WHERE rc.id IN (
      SELECT DISTINCT trc."repositoryCaseId"
      FROM "TestRunCases" trc
      INNER JOIN "TestRuns" tr ON trc."testRunId" = tr.id
      WHERE tr."projectId" = ${projectId}
        AND tr."isDeleted" = false
        AND trc."isDeleted" = false
        ${scopeFragment}
    )
      AND rc."isDeleted" = false
      -- The matrix is the "Parameterized Test Iteration Matrix" — it only
      -- aggregates iterations from parameterized cases. Non-parameterized
      -- cases never have TestRunCaseIteration rows (see iterationFanOut
      -- service) so they would render as a row of em-dashes — visual noise.
      -- A separate non-parameterized report (case × configuration only)
      -- handles those.
      AND rc."hasParameters" = true
    ORDER BY rc.name ASC, rc.id ASC
  `.execute(db.$qb);
  return result.rows;
}

async function fetchConfigAxis(
  db: DbLike,
  projectId: number,
  scopeFragment: RawBuilder<unknown>
): Promise<ConfigRow[]> {
  // "(none)" (config_id 0) always pins to the leftmost column; everything
  // else sorts case-insensitively by name. Postgres' default collation
  // orders "(none)" inconsistently relative to alphabetic names depending
  // on locale, so the explicit pin avoids the surprise.
  //
  // The ORDER BY lives outside the DISTINCT subquery because Postgres
  // requires every ORDER BY expression to appear literally in the SELECT
  // list when DISTINCT is in play — wrapping deduplicates first, then
  // reorders.
  const result = await sql<ConfigRow>`
    SELECT config_id, config_name
    FROM (
      SELECT DISTINCT
        COALESCE(tr."configId", 0)::int AS config_id,
        COALESCE(conf.name, '(none)') AS config_name
      FROM "TestRuns" tr
      LEFT JOIN "Configurations" conf ON tr."configId" = conf.id AND conf."isDeleted" = false
      INNER JOIN "TestRunCases" trc
        ON trc."testRunId" = tr.id
      INNER JOIN "RepositoryCases" rc
        ON trc."repositoryCaseId" = rc.id
      WHERE tr."projectId" = ${projectId}
        AND tr."isDeleted" = false
        AND trc."isDeleted" = false
        AND rc."isDeleted" = false
        AND rc."hasParameters" = true
        ${scopeFragment}
    ) configs
    ORDER BY (config_id = 0) DESC, LOWER(config_name) ASC
  `.execute(db.$qb);
  return result.rows;
}

/**
 * Fetch the canonical snapshot per (case, run) tuple. We pick the
 * snapshot from the MOST RECENT matching run for each case so the
 * matrix presents the latest known parameter-row schema.
 */
async function fetchParamRowsByCaseId(
  db: DbLike,
  projectId: number,
  scopeFragment: RawBuilder<unknown>,
  viewerCanReadSensitive: boolean
): Promise<Map<number, ParamRowAxisItem[]>> {
  const result = await sql<SnapshotRow>`
    SELECT
      trc."repositoryCaseId" AS case_id,
      trcs."rowsJson" AS rows_json,
      trcs."parametersJson" AS parameters_json,
      tr."createdAt" AS created_at
    FROM "TestRunCaseDataSetSnapshot" trcs
    INNER JOIN "TestRunCases" trc ON trcs."testRunCaseId" = trc.id
    INNER JOIN "TestRuns" tr ON trc."testRunId" = tr.id
    WHERE tr."projectId" = ${projectId}
      AND tr."isDeleted" = false
      AND trc."isDeleted" = false
      AND trcs."isDeleted" = false
      ${scopeFragment}
    ORDER BY trc."repositoryCaseId" ASC, tr."createdAt" DESC, trc.id DESC
  `.execute(db.$qb);
  const rows = result.rows;

  const out = new Map<number, ParamRowAxisItem[]>();
  for (const row of rows) {
    const caseId = Number(row.case_id);
    if (out.has(caseId)) continue; // first row per case == most recent run
    const rawRows = (row.rows_json ?? []) as SnapshotRowShape[];
    const parameters = (row.parameters_json ?? []) as ParameterSchemaEntry[];
    if (rawRows.length === 0) {
      // Snapshot exists but has no rows -> non-parameterized case;
      // buildAxes will synthesize the (no parameters) sub-row when the
      // map entry is absent. Skip.
      continue;
    }
    const items: ParamRowAxisItem[] = rawRows.map((r) => {
      const values = (r.valuesJson ?? {}) as Record<string, unknown>;
      return {
        index: r.rowIndex,
        label: r.label ?? null,
        values: redactValues(values, parameters, viewerCanReadSensitive),
      };
    });
    out.set(caseId, items);
  }
  return out;
}

async function fetchStatusMap(db: DbLike): Promise<{
  record: Record<number, StatusMapEntry>;
  rollupMap: Map<number, RollupStatus>;
}> {
  const statuses = await db.status.findMany({
    where: { isDeleted: false },
    select: {
      id: true,
      name: true,
      systemName: true,
      isSuccess: true,
      isFailure: true,
      isCompleted: true,
      order: true,
      color: { select: { value: true } },
    },
  });
  const record: Record<number, StatusMapEntry> = {};
  const rollupMap = new Map<number, RollupStatus>();
  for (const s of statuses) {
    record[s.id] = {
      id: s.id,
      name: s.name,
      isSuccess: s.isSuccess,
      isFailure: s.isFailure,
      isCompleted: s.isCompleted,
      order: s.order,
      colorValue: s.color?.value ?? "#9ca3af",
    };
    rollupMap.set(s.id, {
      id: s.id,
      systemName: s.systemName,
      isSuccess: s.isSuccess,
      isFailure: s.isFailure,
      isCompleted: s.isCompleted,
      order: s.order,
    });
  }
  return { record, rollupMap };
}

async function fetchAggregateCells(
  db: DbLike,
  projectId: number,
  scopeFragment: RawBuilder<unknown>,
  iterationFragment: RawBuilder<unknown>
): Promise<AggregateRow[]> {
  const result = await sql<AggregateRow>`
    SELECT
      trc."repositoryCaseId" AS case_id,
      COALESCE(tr."configId", 0)::int AS config_id,
      iter."rowIndex" AS row_index,
      COUNT(iter.id)::bigint AS iteration_count,
      COUNT(iter.id) FILTER (WHERE st."isSuccess" = true)::bigint AS pass_count,
      COUNT(iter.id) FILTER (WHERE st."isFailure" = true)::bigint AS fail_count,
      COUNT(iter.id) FILTER (WHERE iter."statusId" IS NULL)::bigint AS notrun_count,
      COUNT(iter.id) FILTER (
        WHERE st.id IS NOT NULL
          AND st."isSuccess" = false
          AND st."isFailure" = false
      )::bigint AS other_count,
      MAX(iter."completedAt") AS most_recent_completed_at,
      ARRAY_AGG(iter.id ORDER BY iter.id) AS iteration_ids,
      ARRAY_AGG(
        json_build_object(
          'id', iter.id,
          'rowIndex', iter."rowIndex",
          'label', iter.label,
          'statusId', iter."statusId",
          'runId', tr.id,
          'runName', tr.name,
          'runIsCompleted', tr."isCompleted",
          'completedAt', iter."completedAt"
        ) ORDER BY iter.id
      ) AS iterations_json
    FROM "TestRunCaseIteration" iter
    INNER JOIN "TestRunCases" trc ON iter."testRunCaseId" = trc.id
    INNER JOIN "TestRuns" tr ON trc."testRunId" = tr.id
    LEFT JOIN "Status" st ON st.id = iter."statusId"
    WHERE tr."projectId" = ${projectId}
      AND tr."isDeleted" = false
      AND trc."isDeleted" = false
      AND iter."isDeleted" = false
      ${scopeFragment}
      ${iterationFragment}
    GROUP BY trc."repositoryCaseId", COALESCE(tr."configId", 0), iter."rowIndex"
  `.execute(db.$qb);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export async function runMatrixAggregation(
  db: DbLike,
  projectId: number,
  filters: MatrixFilters,
  viewerCanReadSensitive: boolean
): Promise<AxesShape> {
  // Step 1 — Defense-in-depth preflight. Throws before any aggregation
  // SQL runs if the requested cells exceed the cap. The route layer
  // (Plan 05-02) will normally preflight first; this guard protects
  // direct callers (e.g. the report-builder preset).
  const preflight = await runCellCountPreflight(db, projectId, filters);
  if (preflight.willRefuse) {
    throw new MatrixCellCapExceededError(preflight);
  }

  const { scopeFragment, iterationFragment } = buildFilterFragments(filters);

  const [caseRows, configRows, paramRowsByCaseId, statusMaps, aggregateRows] =
    await Promise.all([
      fetchCaseAxis(db, projectId, scopeFragment),
      fetchConfigAxis(db, projectId, scopeFragment),
      fetchParamRowsByCaseId(
        db,
        projectId,
        scopeFragment,
        viewerCanReadSensitive
      ),
      fetchStatusMap(db),
      fetchAggregateCells(db, projectId, scopeFragment, iterationFragment),
    ]);

  const cases: CaseAxisItem[] = caseRows.map((r) => {
    const params = (r.parameters ?? []) as Array<{
      name: string;
      type: string;
      sensitive: boolean;
    }>;
    return {
      caseId: Number(r.id),
      caseName: r.name,
      hasParameters: r.has_parameters,
      source: r.source,
      automated: r.automated,
      paramRows: [], // filled in by buildAxes from paramRowsByCaseId
      parameters: params.map((p) => ({
        name: p.name,
        type: p.type,
        sensitive: p.sensitive,
      })),
    };
  });

  // BuildAxes consumes a `parameters | null` shape; map accordingly.
  const buildAxesCases = cases.map((c) => ({
    caseId: c.caseId,
    caseName: c.caseName,
    hasParameters: c.hasParameters,
    source: c.source,
    automated: c.automated,
    parameters: c.parameters ?? null,
  }));

  const configAxis: ConfigAxisItem[] = configRows.map((r) => ({
    configId: Number(r.config_id),
    configName: r.config_name,
  }));

  const cells: CellSummary[] = aggregateRows.map((r) => {
    const iterationsRaw = (r.iterations_json ?? []) as IterationJsonShape[];
    const iterations: IterationSummary[] = iterationsRaw.map((i) => ({
      id: Number(i.id),
      rowIndex: Number(i.rowIndex ?? 0),
      label: i.label ?? null,
      statusId: i.statusId == null ? null : Number(i.statusId),
      runId: Number(i.runId),
      runName: i.runName,
      runIsCompleted: Boolean(i.runIsCompleted),
      completedAt: i.completedAt ? new Date(i.completedAt).toISOString() : null,
    }));
    const worstOfStatusId = computeWorstOfStatus(
      iterations.map((i) => ({ statusId: i.statusId })),
      statusMaps.rollupMap
    );
    const completed = r.most_recent_completed_at;
    const mostRecentCompletedAt =
      completed instanceof Date
        ? completed.toISOString()
        : completed
          ? new Date(completed).toISOString()
          : null;
    return {
      caseId: Number(r.case_id),
      configId: Number(r.config_id),
      rowIndex: Number(r.row_index),
      iterationCount: Number(r.iteration_count),
      pass: Number(r.pass_count),
      fail: Number(r.fail_count),
      notRun: Number(r.notrun_count),
      other: Number(r.other_count),
      worstOfStatusId,
      mostRecentCompletedAt,
      iterations,
    };
  });

  return buildAxes({
    cases: buildAxesCases,
    configs: configAxis,
    cells,
    paramRowsByCaseId,
    statusMap: statusMaps.record,
  });
}
