import { baseDb } from "@/lib/db";
import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  format,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { sql } from "kysely";
import { NextRequest } from "next/server";
import { isDateGrouping, type DateGrouping } from "~/lib/reports/dateGrouping";
import {
  isValidTimezone,
  resolveRequestDateRange,
  WEEK_STARTS_ON,
} from "~/lib/reports/dateRangePresets";
import { authorizeReportRequest } from "~/utils/reportApiUtils";
import { parseIdListFilter } from "~/utils/reportFilterParams";
import {
  DEFAULT_TREND_GROUPING,
  DEFAULT_TREND_PERIOD_COUNT,
  DEFAULT_TREND_RUN_SOURCE,
  MAX_TREND_PERIODS,
  isTrendAttemptMode,
  isTrendRunSource,
  rankProjects,
  withRates,
  type ResultsTrendRow,
  type TrendAttemptMode,
  type TrendPeriod,
  type TrendProject,
  type TrendRunSource,
  type TrendSettings,
} from "~/utils/resultsTrendShared";

export type {
  ResultsTrendRow,
  TrendPeriod,
  TrendSettings,
} from "~/utils/resultsTrendShared";

/** One aggregate row from the database: a project's period. */
export interface TrendAggregateRow {
  project_id: number;
  period_start: string;
  runs: number;
  results: number;
  passed: number;
  failed: number;
  skipped: number;
  other: number;
}

export interface TrendWindow {
  /** The periods in the window, oldest first; the one holding now is partial. */
  periods: TrendPeriod[];
  /** The instant the first period starts, for the run filter. */
  from: Date;
  /** The instant after the last period ends (exclusive). */
  to: Date;
}

const startOfPeriod: Record<DateGrouping, (date: Date) => Date> = {
  daily: startOfDay,
  weekly: (date) => startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }),
  monthly: startOfMonth,
  quarterly: startOfQuarter,
  annually: startOfYear,
};

const addPeriods: Record<DateGrouping, (date: Date, n: number) => Date> = {
  daily: addDays,
  weekly: addWeeks,
  monthly: addMonths,
  quarterly: addQuarters,
  annually: addYears,
};

/** Postgres's date_trunc unit for each grouping. */
const TRUNC_UNIT: Record<DateGrouping, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  annually: "year",
};

/**
 * The calendar day a range bound names, as a zoned Date. A relative preset
 * resolves to an instant on the run's timezone, which reads back through
 * that zone; the picker's custom day travels as UTC midnight (start) or
 * the last millisecond of the UTC day (end), which must be read as that
 * calendar day, not shifted into the zone.
 */
function boundaryDay(instant: Date, raw: string, timezone: string): Date {
  const utcDay = /T(00:00:00\.000|23:59:59\.999)Z$/.test(raw);
  if (utcDay) {
    return new Date(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate()
    );
  }
  return toZonedTime(instant, timezone);
}

/**
 * The periods of `grouping` in `timezone` covering the requested range: from
 * the period holding `startDate` to the one holding `endDate` (never past
 * now). Without a start the window is the grouping's default count of
 * periods ending with the one holding now. Period keys are the calendar date
 * each period starts on in that zone.
 */
export function trendPeriods(input: {
  grouping: DateGrouping;
  timezone: string;
  now: Date;
  startDate?: string;
  endDate?: string;
}): TrendWindow {
  const { grouping, timezone, now, startDate, endDate } = input;
  const start = startOfPeriod[grouping];
  const add = addPeriods[grouping];
  const zonedNow = toZonedTime(now, timezone);
  const currentStart = start(zonedNow);

  const requestedEnd = endDate ? new Date(endDate) : null;
  const endInstant =
    requestedEnd && !isNaN(requestedEnd.getTime()) && requestedEnd < now
      ? requestedEnd
      : now;
  const lastStart = start(
    endInstant === now ? zonedNow : boundaryDay(endInstant, endDate!, timezone)
  );

  const requestedStart = startDate ? new Date(startDate) : null;
  let firstStart =
    requestedStart && !isNaN(requestedStart.getTime())
      ? start(boundaryDay(requestedStart, startDate!, timezone))
      : add(lastStart, -(DEFAULT_TREND_PERIOD_COUNT[grouping] - 1));
  // A range wider than the cap keeps its most recent periods.
  const cappedFirst = add(lastStart, -(MAX_TREND_PERIODS - 1));
  if (firstStart < cappedFirst) firstStart = cappedFirst;

  const periods: TrendPeriod[] = [];
  for (let cursor = firstStart; cursor <= lastStart; cursor = add(cursor, 1)) {
    periods.push({
      periodStart: format(cursor, "yyyy-MM-dd"),
      partial: cursor.getTime() === currentStart.getTime(),
    });
  }
  return {
    periods,
    from: fromZonedTime(firstStart, timezone),
    to: fromZonedTime(add(lastStart, 1), timezone),
  };
}

/**
 * The response rows: every project × every period (zero-filled where no run
 * landed) plus a combined row per period, newest period first, the combined
 * row leading each period and the projects in rank order after it.
 */
export function buildTrendRows(input: {
  aggregates: TrendAggregateRow[];
  projects: TrendProject[];
  periods: TrendPeriod[];
  countSkipped: boolean;
}): { rows: ResultsTrendRow[]; projects: TrendProject[] } {
  const { aggregates, projects, periods, countSkipped } = input;
  const periodKeys = new Set(periods.map((period) => period.periodStart));
  const byKey = new Map<string, TrendAggregateRow>();
  for (const aggregate of aggregates) {
    // The run filter bounds the query to the window; a key outside it would
    // only come from a clock skew at the edge.
    if (!periodKeys.has(aggregate.period_start)) continue;
    byKey.set(`${aggregate.project_id}:${aggregate.period_start}`, aggregate);
  }

  const zero = (project: TrendProject | null, period: TrendPeriod) => ({
    project,
    periodStart: period.periodStart,
    partial: period.partial,
    runs: 0,
    results: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    other: 0,
  });

  const projectRows: ResultsTrendRow[] = [];
  const combinedByPeriod = new Map<string, ReturnType<typeof zero>>();
  for (const period of periods) {
    combinedByPeriod.set(period.periodStart, zero(null, period));
  }
  for (const project of projects) {
    for (const period of periods) {
      const counts = zero(project, period);
      const aggregate = byKey.get(`${project.id}:${period.periodStart}`);
      if (aggregate) {
        counts.runs = Number(aggregate.runs);
        counts.results = Number(aggregate.results);
        counts.passed = Number(aggregate.passed);
        counts.failed = Number(aggregate.failed);
        counts.skipped = Number(aggregate.skipped);
        counts.other = Number(aggregate.other);
      }
      const combined = combinedByPeriod.get(period.periodStart)!;
      combined.runs += counts.runs;
      combined.results += counts.results;
      combined.passed += counts.passed;
      combined.failed += counts.failed;
      combined.skipped += counts.skipped;
      combined.other += counts.other;
      projectRows.push(withRates(counts, countSkipped));
    }
  }

  const rankedProjects = rankProjects(projects, projectRows);
  const rank = new Map(rankedProjects.map((project, i) => [project.id, i]));
  const combinedRows = [...combinedByPeriod.values()].map((counts) =>
    withRates(counts, countSkipped)
  );
  const rows = [...combinedRows, ...projectRows].sort(
    (a, b) =>
      b.periodStart.localeCompare(a.periodStart) ||
      (a.project === null ? -1 : rank.get(a.project.id)!) -
        (b.project === null ? -1 : rank.get(b.project.id)!)
  );
  return { rows, projects: rankedProjects };
}

/** The run filters every query shares: project scope, aborted runs, run type. */
function runFilters(input: {
  projectIds: number[] | null;
  includeAborted: boolean;
  runSource: TrendRunSource;
}) {
  const { projectIds, includeAborted, runSource } = input;
  const projectFilter = projectIds
    ? sql`AND tr."projectId" = ANY(${projectIds})`
    : sql``;
  // An aborted run is one sitting in its project's abandoned-run state.
  const abortedFilter = includeAborted
    ? sql``
    : sql`AND NOT EXISTS (
        SELECT 1 FROM "Projects" p
        WHERE p.id = tr."projectId" AND p."abandonedRunStateId" = tr."stateId"
      )`;
  const runTypeFilter =
    runSource === "automated"
      ? sql`AND tr."testRunType" <> 'REGULAR'`
      : runSource === "manual"
        ? sql`AND tr."testRunType" IN ('REGULAR', 'HYBRID')`
        : sql``;
  return sql`${runTypeFilter} ${projectFilter} ${abortedFilter}`;
}

/**
 * When the earliest counted run was created, for the all-time window a run
 * without a date range covers. Null when nothing qualifies.
 */
async function queryEarliestRun(input: {
  projectIds: number[] | null;
  includeAborted: boolean;
  runSource: TrendRunSource;
}): Promise<Date | null> {
  const result = await sql<{ earliest: Date | string | null }>`
    SELECT MIN(tr."createdAt") AS earliest
    FROM "TestRuns" tr
    WHERE tr."isDeleted" = false
      ${runFilters(input)}
  `.execute(baseDb.$qb);
  const earliest = result.rows[0]?.earliest;
  return earliest ? new Date(earliest) : null;
}

/**
 * Result counts by project and period: every result row of every run created
 * in the window, bucketed by its status flags and grouped by the run's
 * project and the period (day, Monday-start week, month, quarter or year, in
 * `timezone`) its creation falls in. Runs are counted distinctly, so a run
 * with no results yet still counts as a run.
 *
 * `runSource` picks the runs and the result rows: automated runs (every
 * type but REGULAR) with their JUnit results, manual runs (REGULAR and
 * HYBRID) with their recorded results, or both together.
 *
 * A result's bucket reads the Status row's flags — never the status name:
 * isSuccess is passed, isFailure is failed, and a status that is completed
 * without either verdict is skipped. Everything else (blocked, retest, an
 * admin-defined status with no verdict) is "other". A JUnit result with no
 * status at all falls back to its JUnit type.
 */
async function queryTrendAggregates(input: {
  projectIds: number[] | null;
  from: Date;
  to: Date;
  grouping: DateGrouping;
  timezone: string;
  includeAborted: boolean;
  attemptMode: TrendAttemptMode;
  runSource: TrendRunSource;
}): Promise<TrendAggregateRow[]> {
  const {
    projectIds,
    from,
    to,
    grouping,
    timezone,
    includeAborted,
    attemptMode,
    runSource,
  } = input;
  const unit = TRUNC_UNIT[grouping];
  const filters = runFilters({ projectIds, includeAborted, runSource });
  // "Latest attempt only" keeps one result per case per run: the newest by
  // execution time, then by id for results imported without one.
  const distinctOn =
    attemptMode === "latest" ? sql`DISTINCT ON (run_id, case_id)` : sql``;
  const distinctOrder =
    attemptMode === "latest"
      ? sql`ORDER BY run_id, case_id, executed_at DESC NULLS LAST, result_id DESC`
      : sql``;

  const automatedResults = sql`
    SELECT
      ts."testRunId" AS run_id,
      jr."repositoryCaseId" AS case_id,
      jr."executedAt" AS executed_at,
      jr.id AS result_id,
      CASE
        WHEN s."isSuccess" THEN 'passed'
        WHEN s."isFailure" THEN 'failed'
        WHEN s."isCompleted" THEN 'skipped'
        WHEN s.id IS NULL AND jr.type = 'PASSED' THEN 'passed'
        WHEN s.id IS NULL AND jr.type IN ('FAILURE', 'ERROR') THEN 'failed'
        WHEN s.id IS NULL AND jr.type = 'SKIPPED' THEN 'skipped'
        ELSE 'other'
      END AS bucket
    FROM "JUnitTestResult" jr
    INNER JOIN "JUnitTestSuite" ts ON ts.id = jr."testSuiteId"
    INNER JOIN runs ON runs.id = ts."testRunId"
    LEFT JOIN "Status" s ON s.id = jr."statusId"`;
  const manualResults = sql`
    SELECT
      trr."testRunId" AS run_id,
      trc."repositoryCaseId" AS case_id,
      trr."executedAt" AS executed_at,
      trr.id AS result_id,
      CASE
        WHEN s."isSuccess" THEN 'passed'
        WHEN s."isFailure" THEN 'failed'
        WHEN s."isCompleted" THEN 'skipped'
        ELSE 'other'
      END AS bucket
    FROM "TestRunResults" trr
    INNER JOIN runs ON runs.id = trr."testRunId"
    INNER JOIN "TestRunCases" trc ON trc.id = trr."testRunCaseId" AND trc."isDeleted" = false
    INNER JOIN "Status" s ON s.id = trr."statusId"
    WHERE trr."isDeleted" = false`;
  const sourceRows =
    runSource === "automated"
      ? automatedResults
      : runSource === "manual"
        ? manualResults
        : sql`${automatedResults} UNION ALL ${manualResults}`;

  const result = await sql<TrendAggregateRow>`
    WITH runs AS (
      SELECT
        tr.id,
        tr."projectId" AS project_id,
        to_char(date_trunc(${unit}, tr."createdAt" AT TIME ZONE ${timezone}), 'YYYY-MM-DD') AS period_start
      FROM "TestRuns" tr
      WHERE tr."isDeleted" = false
        AND tr."createdAt" >= ${from}
        AND tr."createdAt" < ${to}
        ${filters}
    ),
    results AS (
      SELECT ${distinctOn} run_id, bucket
      FROM (${sourceRows}) AS source_rows
      ${distinctOrder}
    )
    SELECT
      runs.project_id,
      runs.period_start,
      COUNT(DISTINCT runs.id)::int AS runs,
      COUNT(r.run_id)::int AS results,
      COUNT(r.run_id) FILTER (WHERE r.bucket = 'passed')::int AS passed,
      COUNT(r.run_id) FILTER (WHERE r.bucket = 'failed')::int AS failed,
      COUNT(r.run_id) FILTER (WHERE r.bucket = 'skipped')::int AS skipped,
      COUNT(r.run_id) FILTER (WHERE r.bucket = 'other')::int AS other
    FROM runs
    LEFT JOIN results r ON r.run_id = runs.id
    GROUP BY runs.project_id, runs.period_start
  `.execute(baseDb.$qb);
  return result.rows;
}

export async function handleResultsTrendPOST(
  req: NextRequest,
  isCrossProject: boolean
) {
  try {
    const body = await req.json();
    const authz = await authorizeReportRequest(req, {
      requiresAdmin: isCrossProject,
      projectId: body?.projectId ? Number(body.projectId) : undefined,
    });
    if (!authz.ok) return authz.response;

    const {
      projectId,
      dateGrouping: dateGroupingParam,
      countSkipped = false,
      includeAborted = true,
      attemptMode: attemptModeParam = "all",
      runSource: runSourceParam = DEFAULT_TREND_RUN_SOURCE,
      showPassRate = false,
      showFailRate = true,
      showCounts = false,
      timezone: timezoneParam,
      dateRangeTimezone,
    } = body as {
      projectId?: number | string;
      dateGrouping?: string;
      countSkipped?: boolean;
      includeAborted?: boolean;
      attemptMode?: string;
      runSource?: string;
      showPassRate?: boolean;
      showFailRate?: boolean;
      showCounts?: boolean;
      timezone?: string | null;
      dateRangeTimezone?: string | null;
    };
    if (!isCrossProject && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const dateGrouping: DateGrouping = isDateGrouping(dateGroupingParam)
      ? dateGroupingParam
      : DEFAULT_TREND_GROUPING;
    const attemptMode: TrendAttemptMode = isTrendAttemptMode(attemptModeParam)
      ? attemptModeParam
      : "all";
    const runSource: TrendRunSource = isTrendRunSource(runSourceParam)
      ? runSourceParam
      : DEFAULT_TREND_RUN_SOURCE;
    // Periods are cut on the viewer's calendar; a share replays the saver's
    // so every viewer of the link sees the same periods.
    const timezone = isValidTimezone(timezoneParam)
      ? timezoneParam
      : isValidTimezone(dateRangeTimezone)
        ? dateRangeTimezone
        : "UTC";
    const settings: TrendSettings = {
      dateGrouping,
      runSource,
      countSkipped: countSkipped === true,
      includeAborted: includeAborted !== false,
      attemptMode,
      // Chart options carried in the run so saves and shares keep them.
      showPassRate: showPassRate === true,
      showFailRate: showFailRate !== false,
      showCounts: showCounts === true,
      timezone,
    };

    const filteredProjectIds = isCrossProject
      ? parseIdListFilter(body.projectIds)
      : [Number(projectId)];
    // The range follows the standard report date range (a relative preset
    // resolves on the stored timezone). Without one the report covers all
    // time: from the period holding the earliest counted run. With no run at
    // all, trendPeriods falls back to the grouping's default span so the
    // empty report still has an axis.
    const range = resolveRequestDateRange(body);
    const earliest = range.startDate
      ? null
      : await queryEarliestRun({
          projectIds: filteredProjectIds,
          includeAborted: settings.includeAborted,
          runSource,
        });
    const { periods, from, to } = trendPeriods({
      grouping: dateGrouping,
      timezone,
      now: new Date(),
      startDate: range.startDate ?? earliest?.toISOString(),
      endDate: range.endDate,
    });

    const aggregates = await queryTrendAggregates({
      projectIds: filteredProjectIds,
      from,
      to,
      grouping: dateGrouping,
      timezone,
      includeAborted: settings.includeAborted,
      attemptMode,
      runSource,
    });

    // Only projects with a counted run in the window get a row; the
    // picker still offers every project.
    const activeProjectIds = [...new Set(aggregates.map((a) => a.project_id))];
    const projects: TrendProject[] =
      activeProjectIds.length === 0
        ? []
        : await baseDb.projects.findMany({
            where: { id: { in: activeProjectIds } },
            select: { id: true, name: true, iconUrl: true },
          });

    const built = buildTrendRows({
      aggregates,
      projects,
      periods,
      countSkipped: settings.countSkipped,
    });

    return Response.json({
      data: built.rows,
      total: built.rows.length,
      periods,
      projects: built.projects,
      settings,
      dateGrouping,
    });
  } catch (e: unknown) {
    console.error("Results trend report error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
