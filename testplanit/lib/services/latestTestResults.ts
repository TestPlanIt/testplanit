import { baseDb } from "@/lib/db";
import { sql } from "kysely";
import type { TestResultExecution } from "~/lib/types/latestTestResults";

/**
 * The last N executions of a test case, newest first.
 *
 * A case can be executed two ways — manually, recorded as TestRunResults against
 * a TestRunCase, and by an automated run, recorded as JUnitTestResult — and
 * "latest" has to consider both. The two are unioned, normalised to a common
 * shape, then ranked per case in the database with a window function so only
 * the rows that will actually be shown come back.
 *
 * Consumers: the Latest Results column in the repository case list, and the
 * Flaky Test Report's execution history.
 */

export interface RawExecutionResult {
  test_case_id: number;
  test_case_name: string;
  test_case_source: string;
  test_case_has_parameters: boolean;
  result_id: number;
  test_run_id: number | null;
  status_name: string;
  status_color: string;
  is_success: boolean;
  is_failure: boolean;
  status_order: number | null;
  executed_at: Date;
  row_num: bigint;
  project_id?: number;
  project_name?: string;
}

export interface LatestTestResultsQueryOptions {
  /** How many executions to keep per case. */
  limit: number;
  /** Restrict to these cases. Omit to consider every case matching the other filters. */
  caseIds?: number[];
  /** Restrict to one project. */
  projectId?: number | null;
  /** Only executions at or after this instant. */
  startDate?: Date | null;
  /** Only executions at or before this instant. */
  endDate?: Date | null;
  /**
   * Restrict to cases with these `RepositoryCases.source` values, e.g. the
   * automated sources or the manual ones.
   */
  sources?: string[] | null;
  /**
   * Restrict by the case's `automated` flag — the definitive automated
   * marker (reporters flip it; source records where the case came from).
   */
  automatedFlag?: boolean | null;
  /**
   * Select the project and rank per (case, project) rather than per case. Used
   * by the cross-project flaky report, where one case id can appear under
   * several projects.
   */
  includeProject?: boolean;
}

/**
 * Ranked executions, newest first, at most `limit` per case.
 *
 * Every filter is an optional SQL fragment composed into one statement, so the
 * combinations do not multiply into separate hand-written queries.
 */
export async function queryLatestTestResults({
  limit,
  caseIds,
  projectId,
  startDate,
  endDate,
  sources,
  automatedFlag,
  includeProject = false,
}: LatestTestResultsQueryOptions): Promise<RawExecutionResult[]> {
  // An empty id list means "no cases", which no WHERE clause can express —
  // return early rather than emitting `IN ()`.
  if (caseIds && caseIds.length === 0) {
    return [];
  }

  const projectSelectFields = includeProject
    ? sql`, p.id as project_id, p.name as project_name`
    : sql``;
  const projectJoin = includeProject
    ? sql`INNER JOIN "Projects" p ON p.id = rc."projectId"`
    : sql``;
  const partitionBy = includeProject
    ? sql`PARTITION BY test_case_id, project_id`
    : sql`PARTITION BY test_case_id`;

  const caseFilter = caseIds ? sql`AND rc.id = ANY(${caseIds})` : sql``;
  const projectFilter =
    projectId != null ? sql`AND rc."projectId" = ${projectId}` : sql``;
  const sourceFilter = sources
    ? sql`AND rc.source::text = ANY(${sources})`
    : sql``;
  const automatedFlagFilter =
    automatedFlag == null ? sql`` : sql`AND rc."automated" = ${automatedFlag}`;
  const manualDateFilter = sql`${
    startDate ? sql`AND trr."executedAt" >= ${startDate}` : sql``
  } ${endDate ? sql`AND trr."executedAt" <= ${endDate}` : sql``}`;
  const automatedDateFilter = sql`${
    startDate ? sql`AND jr."executedAt" >= ${startDate}` : sql``
  } ${endDate ? sql`AND jr."executedAt" <= ${endDate}` : sql``}`;

  return (
    await sql<RawExecutionResult>`
      WITH combined_results AS (
        SELECT
          rc.id as test_case_id,
          rc.name as test_case_name,
          rc.source::text as test_case_source,
          rc."hasParameters" as test_case_has_parameters,
          trr.id as result_id,
          CASE WHEN tr."isDeleted" = false THEN trc."testRunId" ELSE NULL END as test_run_id,
          s.name as status_name,
          c.value as status_color,
          s."isSuccess" as is_success,
          s."isFailure" as is_failure,
          s."order" as status_order,
          trr."executedAt" as executed_at
          ${projectSelectFields}
        FROM "RepositoryCases" rc
        ${projectJoin}
        INNER JOIN "TestRunCases" trc ON trc."repositoryCaseId" = rc.id
        LEFT JOIN "TestRuns" tr ON tr.id = trc."testRunId"
        INNER JOIN "TestRunResults" trr ON trr."testRunCaseId" = trc.id AND trr."isDeleted" = false
        INNER JOIN "Status" s ON s.id = trr."statusId" AND s."systemName" NOT IN ('untested', 'skipped')
        INNER JOIN "Color" c ON c.id = s."colorId"
        WHERE rc."isDeleted" = false
          ${caseFilter}
          ${projectFilter}
          ${sourceFilter}
          ${automatedFlagFilter}
          ${manualDateFilter}

        UNION ALL

        SELECT
          rc.id as test_case_id,
          rc.name as test_case_name,
          rc.source::text as test_case_source,
          rc."hasParameters" as test_case_has_parameters,
          jr.id as result_id,
          CASE WHEN tr."isDeleted" = false THEN jts."testRunId" ELSE NULL END as test_run_id,
          COALESCE(s.name, jr.type::text) as status_name,
          COALESCE(c.value,
            CASE jr.type
              WHEN 'PASSED' THEN '#22c55e'
              WHEN 'FAILURE' THEN '#ef4444'
              WHEN 'ERROR' THEN '#f97316'
              ELSE '#6b7280'
            END
          ) as status_color,
          COALESCE(s."isSuccess", jr.type = 'PASSED') as is_success,
          COALESCE(s."isFailure", jr.type IN ('FAILURE', 'ERROR')) as is_failure,
          s."order" as status_order,
          jr."executedAt" as executed_at
          ${projectSelectFields}
        FROM "RepositoryCases" rc
        ${projectJoin}
        INNER JOIN "JUnitTestResult" jr ON jr."repositoryCaseId" = rc.id
        INNER JOIN "JUnitTestSuite" jts ON jts.id = jr."testSuiteId"
        LEFT JOIN "TestRuns" tr ON tr.id = jts."testRunId"
        LEFT JOIN "Status" s ON s.id = jr."statusId"
        LEFT JOIN "Color" c ON c.id = s."colorId"
        WHERE rc."isDeleted" = false
          ${caseFilter}
          ${projectFilter}
          ${sourceFilter}
          ${automatedFlagFilter}
          AND jr.type != 'SKIPPED'
          AND jr."executedAt" IS NOT NULL
          ${automatedDateFilter}
      ),
      ranked_results AS (
        SELECT
          test_case_id,
          test_case_name,
          test_case_source,
          test_case_has_parameters,
          result_id,
          test_run_id,
          status_name,
          status_color,
          is_success,
          is_failure,
          status_order,
          executed_at
          ${includeProject ? sql`, project_id, project_name` : sql``},
          ROW_NUMBER() OVER (${partitionBy} ORDER BY executed_at DESC) as row_num
        FROM combined_results
      )
      SELECT * FROM ranked_results WHERE row_num <= ${limit}
      ORDER BY test_case_id${includeProject ? sql`, project_id` : sql``}, row_num
    `.execute(baseDb.$qb)
  ).rows;
}

/**
 * The last `limit` executions for each of `caseIds`, newest first, keyed by
 * case id. Cases with no executions are absent from the map.
 */
export async function getLatestTestResultsByCase(
  caseIds: number[],
  limit: number
): Promise<Map<number, TestResultExecution[]>> {
  const rows = await queryLatestTestResults({ caseIds, limit });

  const byCase = new Map<number, TestResultExecution[]>();
  for (const row of rows) {
    const executions = byCase.get(row.test_case_id) ?? [];
    executions.push({
      resultId: row.result_id,
      testRunId: row.test_run_id,
      statusName: row.status_name,
      statusColor: row.status_color,
      isSuccess: row.is_success,
      isFailure: row.is_failure,
      executedAt: new Date(row.executed_at).toISOString(),
    });
    byCase.set(row.test_case_id, executions);
  }
  return byCase;
}

/**
 * Case ids ordered by the status of their most recent execution, then by how
 * recent that execution was.
 *
 * Cases that have never been executed always sort last, in either direction —
 * "no result" is not a status, and burying them keeps the informative rows
 * together at the top.
 */
export async function orderCaseIdsByLatestStatus(
  caseIds: number[],
  direction: "asc" | "desc"
): Promise<number[]> {
  const rows = await queryLatestTestResults({ caseIds, limit: 1 });
  return sortCaseIdsByNewestStatus(caseIds, rows, direction);
}

/**
 * Ordering rule, separated from the query so it can be exercised directly.
 */
export function sortCaseIdsByNewestStatus(
  caseIds: number[],
  newestRows: Pick<
    RawExecutionResult,
    "test_case_id" | "status_order" | "executed_at"
  >[],
  direction: "asc" | "desc"
): number[] {
  const newest = new Map<number, { order: number; executedAt: number }>();
  for (const row of newestRows) {
    newest.set(row.test_case_id, {
      // A status with no configured order sorts after the configured ones.
      order: row.status_order ?? Number.MAX_SAFE_INTEGER,
      executedAt: new Date(row.executed_at).getTime(),
    });
  }

  const sign = direction === "asc" ? 1 : -1;
  return [...caseIds].sort((a, b) => {
    const left = newest.get(a);
    const right = newest.get(b);
    if (!left && !right) return a - b;
    if (!left) return 1;
    if (!right) return -1;
    if (left.order !== right.order) return sign * (left.order - right.order);
    // Same status: most recently executed first, so the ordering is stable and
    // the freshest evidence for that status leads.
    if (left.executedAt !== right.executedAt) {
      return right.executedAt - left.executedAt;
    }
    return a - b;
  });
}
