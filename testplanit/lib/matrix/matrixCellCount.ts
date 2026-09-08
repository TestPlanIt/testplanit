/**
 * Matrix cell-count preflight.
 *
 * Two exports:
 *   - `computeCellCount` — pure math; per-case sub-axis sum.
 *   - `runCellCountPreflight` — DB-backed; runs two cheap raw aggregates
 *     against TestRunCases.totalIterations (the Phase 3 denormalized
 *     counter) plus a config DISTINCT.
 *
 * The preflight is the gate the API route at
 * `/api/projects/[projectId]/matrix/cell-count` returns directly, AND
 * the defense-in-depth gate inside `runMatrixAggregation` so the
 * aggregator refuses to do work on overflowing requests even if the
 * route forgets to preflight.
 *
 * SECURITY: this helper assumes the caller has already gated by project
 * via `getEnhancedDb(session).projects.findFirst({ where: { id: projectId } })`.
 * Raw SQL bypasses ZenStack policies; the route layer is the security
 * boundary.
 */

import { sql } from "kysely";
import type { RawBuilder } from "kysely";

import type { DbClient, TxClient } from "~/lib/zenstack";

import type { MatrixCellCountResult, MatrixFilters } from "./types";

/**
 * Accept either the singleton client or a `TxClient` so
 * callers (and live-DB integration tests) can pass `tx` to read inside
 * a rolled-back transaction.
 */
type DbLike = DbClient | TxClient;

const CELL_CAP_THRESHOLD = 50_000 as const;

/**
 * Pure math: sum (max(1, perCase.maxIterations) × max(1, configCount))
 * across all cases. The `Math.max(1, ...)` on each side enforces
 * PARAM-07 (a non-parameterized case still contributes one synthetic
 * sub-row) and the "(none)" sentinel column collapse for projects with
 * no configurations.
 *
 * Do NOT collapse this to `Math.max(...maxIterations)` — that's the
 * global axis math, which over-counts.
 */
export function computeCellCount(input: {
  perCaseMaxIterations: Array<{ caseId: number; maxIterations: number }>;
  configCount: number;
}): number {
  const fanOut = Math.max(1, input.configCount);
  let total = 0;
  for (const c of input.perCaseMaxIterations) {
    total += Math.max(1, c.maxIterations) * fanOut;
  }
  return total;
}

/**
 * Compose the WHERE clause shared by every cell-count query. The
 * `[+ filter predicates]` part of the plan: status, config, dataset,
 * date range. Empty arrays are omitted entirely (never `IN ()` — that's
 * a SQL syntax error).
 *
 * Predicate sources (CONTEXT locks):
 *   - statusIds  -> EXISTS subquery on TestRunCaseIteration.statusId
 *   - configIds  -> COALESCE(tr.configId, 0) IN (...)
 *   - datasetIds -> EXISTS subquery on TestRunCaseDataSetSnapshot.sourceDataSetId
 *   - dateFrom/To -> tr."createdAt" bounds (NOT iter.completedAt)
 */
function buildFilterPredicates(filters: MatrixFilters): RawBuilder<unknown> {
  const fragments: RawBuilder<unknown>[] = [];

  if (filters.configIds && filters.configIds.length > 0) {
    fragments.push(
      sql`AND COALESCE(tr."configId", 0) = ANY(${filters.configIds}::int[])`
    );
  }

  if (filters.dateFrom) {
    fragments.push(sql`AND tr."createdAt" >= ${new Date(filters.dateFrom)}`);
  }
  if (filters.dateTo) {
    fragments.push(sql`AND tr."createdAt" <= ${new Date(filters.dateTo)}`);
  }

  if (filters.statusIds && filters.statusIds.length > 0) {
    fragments.push(sql`AND EXISTS (
      SELECT 1 FROM "TestRunCaseIteration" iter
      WHERE iter."testRunCaseId" = trc.id
        AND iter."isDeleted" = false
        AND iter."statusId" = ANY(${filters.statusIds}::int[])
    )`);
  }

  if (filters.datasetIds && filters.datasetIds.length > 0) {
    fragments.push(sql`AND EXISTS (
      SELECT 1 FROM "TestRunCaseDataSetSnapshot" trcs
      WHERE trcs."testRunCaseId" = trc.id
        AND trcs."isDeleted" = false
        AND trcs."sourceDataSetId" = ANY(${filters.datasetIds}::int[])
    )`);
  }

  if (fragments.length === 0) return sql``;
  return sql.join(fragments, sql` `);
}

interface AxisCountsRow {
  case_count: bigint;
  config_count: bigint;
}

interface PerCaseRow {
  case_id: number;
  max_iters: number;
}

/**
 * DB-backed preflight. Two raw queries:
 *   1. Distinct case + config counts under the requested filters.
 *   2. Per-case max iterations from the Phase 3 denormalized counter.
 *
 * Both use parameterized Kysely `sql` queries. Filter values flow in via
 * `sql` fragments; nothing is string-interpolated.
 *
 * The config-count query intentionally counts `COALESCE(tr."configId", 0)`
 * so the "(none)" sentinel column counts as one configuration even when
 * every run in scope has `configId IS NULL`.
 */
export async function runCellCountPreflight(
  db: DbLike,
  projectId: number,
  filters: MatrixFilters
): Promise<MatrixCellCountResult> {
  const filterSql = buildFilterPredicates(filters);

  // Both axis-count + per-case queries restrict to parameterized cases
  // (`rc."hasParameters" = true`) so the cell-cap notice's "Test cases: N"
  // and total cell count match what the matrix actually renders. Without
  // this filter the preflight would over-count cases (and inflate the
  // suggested "filter to fewer cases" hint) by including non-parameterized
  // cases that the matrix excludes.
  const axisCountsRows = (
    await sql<AxisCountsRow>`
    SELECT
      COUNT(DISTINCT trc."repositoryCaseId")::bigint AS case_count,
      COUNT(DISTINCT COALESCE(tr."configId", 0))::bigint AS config_count
    FROM "TestRunCases" trc
    INNER JOIN "TestRuns" tr ON trc."testRunId" = tr.id
    INNER JOIN "RepositoryCases" rc ON trc."repositoryCaseId" = rc.id
    WHERE tr."projectId" = ${projectId}
      AND tr."isDeleted" = false
      AND trc."isDeleted" = false
      AND rc."isDeleted" = false
      AND rc."hasParameters" = true
      ${filterSql}
  `.execute(db.$qb)
  ).rows;

  const caseCount = Number(axisCountsRows[0]?.case_count ?? 0n);
  const configCount = Number(axisCountsRows[0]?.config_count ?? 0n);

  const perCaseRows = (
    await sql<PerCaseRow>`
    SELECT
      trc."repositoryCaseId" AS case_id,
      MAX(trc."totalIterations")::int AS max_iters
    FROM "TestRunCases" trc
    INNER JOIN "TestRuns" tr ON trc."testRunId" = tr.id
    INNER JOIN "RepositoryCases" rc ON trc."repositoryCaseId" = rc.id
    WHERE tr."projectId" = ${projectId}
      AND tr."isDeleted" = false
      AND trc."isDeleted" = false
      AND rc."isDeleted" = false
      AND rc."hasParameters" = true
      ${filterSql}
    GROUP BY trc."repositoryCaseId"
  `.execute(db.$qb)
  ).rows;

  const perCaseMaxIterations = perCaseRows.map((r) => ({
    caseId: Number(r.case_id),
    maxIterations: Number(r.max_iters ?? 0),
  }));

  const cellCount = computeCellCount({ perCaseMaxIterations, configCount });
  const willRefuse = cellCount > CELL_CAP_THRESHOLD;

  return {
    cellCount,
    willRefuse,
    threshold: CELL_CAP_THRESHOLD,
    axisCounts: {
      caseCount,
      configCount,
      perCaseMaxIterations,
    },
  };
}
