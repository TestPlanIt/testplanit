/**
 * Pure CSV-row builders for the report results table.
 *
 * Report columns render composite React cells (links, badges, the P/F/U
 * widget) and JSX headers, so values can't be pulled generically off the
 * column defs — each report type gets an explicit transform here, mirroring
 * the per-type approach in `hooks/useDrillDownExport.ts`. Each builder returns
 * an array of `{ "Header Label": value }` objects ready for `Papa.unparse`.
 *
 * Translation lookups go through an injected `t` (an unscoped next-intl
 * translator) so this module stays pure and unit-testable.
 */

import { format } from "date-fns";
import { toHumanReadable } from "~/utils/duration";
import { metricUnit } from "~/utils/metricUnits";

export type Translate = (
  key: string,
  values?: Record<string, unknown>
) => string;
export type CsvRow = Record<string, string | number>;

export interface BuildReportCsvParams {
  /** Report type id, possibly prefixed with "cross-project-". */
  reportType: string;
  /** The full result set (already in memory / fetched). */
  rows: any[];
  /** Selected dimensions (custom reports) — `{ value, label }`. */
  dimensions?: Array<{ value: string; label: string }>;
  /** Selected metrics (custom reports) — `{ value, label, apiLabel? }`. */
  metrics?: Array<{ value: string; label: string; apiLabel?: string }>;
  /** Whether this is a cross-project report (adds a Project column). */
  isCrossProject: boolean;
  /** Flaky-tests "last N results" window. */
  consecutiveRuns?: number;
  /** Automation-trends projects (drives per-project columns). */
  projects?: Array<{ id: number; name: string }>;
  locale: string;
  t: Translate;
}

/** Strip the "cross-project-" prefix to get the base report type. */
export function getBaseReportType(reportType: string): string {
  return reportType.replace(/^cross-project-/, "");
}

// ---- formatting helpers -------------------------------------------------

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : format(d, "yyyy-MM-dd HH:mm:ss");
}

/** Date in UTC components — for grouping dates the backend stores at UTC midnight. */
function fmtDateUtc(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDuration(
  value: number | null | undefined,
  isSeconds: boolean,
  locale: string
): string {
  if (!value || value <= 0) return "";
  return toHumanReadable(value, { isSeconds, locale, largest: 2, round: true });
}

function fmtPercent(value: number | null | undefined, decimals = 0): string {
  if (typeof value !== "number" || isNaN(value)) return "";
  return `${value.toFixed(decimals)}%`;
}

const HEALTH_STATUS_KEY: Record<string, string> = {
  healthy: "reports.ui.testCaseHealth.healthStatus.healthy",
  never_executed: "reports.ui.testCaseHealth.healthStatus.neverExecuted",
  always_passing: "reports.ui.testCaseHealth.healthStatus.alwaysPassing",
  always_failing: "reports.ui.testCaseHealth.healthStatus.alwaysFailing",
};

// ---- per-type builders --------------------------------------------------

function buildFlakyTests(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, isCrossProject, consecutiveRuns = 5 } = p;
  const hProject = t("reports.dimensions.project");
  const hCase = t("reports.dimensions.testCase");
  const hFlips = t("reports.ui.flakyTests.flips");
  const hResults = t("reports.ui.flakyTests.lastNResults", {
    count: consecutiveRuns,
  });
  return rows.map((r: any) => {
    const row: CsvRow = {};
    if (isCrossProject) row[hProject] = r.project?.name ?? "";
    row[hCase] = r.testCaseName ?? "";
    row[hFlips] = r.flipCount ?? 0;
    row[hResults] = (r.executions ?? [])
      .slice(0, consecutiveRuns)
      .map((e: any) => e.statusName)
      .filter(Boolean)
      .join(" ");
    return row;
  });
}

function buildTestCaseHealth(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, isCrossProject } = p;
  const h = {
    project: t("reports.dimensions.project"),
    testCase: t("reports.dimensions.testCase"),
    status: t("reports.ui.testCaseHealth.status"),
    stale: t("reports.ui.testCaseHealth.healthStatus.stale"),
    score: t("reports.ui.testCaseHealth.healthScore"),
    lastExecuted: t("reports.ui.testCaseHealth.lastExecuted"),
    executions: t("reports.ui.testCaseHealth.executions"),
    passRate: t("reports.ui.testCaseHealth.passRate"),
  };
  const never = t("reports.ui.testCaseHealth.never");
  return rows.map((r: any) => {
    const row: CsvRow = {};
    if (isCrossProject) row[h.project] = r.project?.name ?? "";
    row[h.testCase] = r.testCaseName ?? "";
    row[h.status] = HEALTH_STATUS_KEY[r.healthStatus]
      ? t(HEALTH_STATUS_KEY[r.healthStatus])
      : (r.healthStatus ?? "");
    row[h.stale] = r.isStale ? t("common.yes") : t("common.no");
    row[h.score] = r.healthScore ?? 0;
    row[h.lastExecuted] = r.lastExecutedAt
      ? fmtDateTime(r.lastExecutedAt)
      : never;
    row[h.executions] = r.totalExecutions ?? 0;
    row[h.passRate] = r.totalExecutions > 0 ? fmtPercent(r.passRate) : "";
    return row;
  });
}

function buildIssueTestCoverage(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, isCrossProject } = p;
  const h = {
    project: t("reports.dimensions.project"),
    issue: t("reports.ui.issueTestCoverage.issue"),
    testCase: t("reports.ui.issueTestCoverage.testCase"),
    status: t("reports.ui.issueTestCoverage.issueStatus"),
    priority: t("reports.ui.issueTestCoverage.priority"),
    lastStatus: t("reports.ui.issueTestCoverage.lastStatus"),
    lastExecuted: t("reports.ui.issueTestCoverage.lastExecuted"),
  };
  const notTested = t("reports.ui.issueTestCoverage.notTested");
  // One row per issue × test case (the underlying flat shape), so the export
  // is data-complete; the grouped P/F/U aggregates are a view convenience.
  return rows.map((r: any) => {
    const key = r.externalKey || r.externalId || r.issueName || "";
    const row: CsvRow = {};
    if (isCrossProject) row[h.project] = r.project?.name ?? "";
    row[h.issue] = r.issueTitle ? `${key}: ${r.issueTitle}` : String(key);
    row[h.testCase] = r.testCaseName ?? "";
    row[h.status] = r.issueStatus ?? r.issueExternalStatus ?? "";
    row[h.priority] = r.issuePriority ?? "";
    row[h.lastStatus] = r.lastStatusName ?? notTested;
    row[h.lastExecuted] = fmtDateTime(r.lastExecutedAt);
    return row;
  });
}

function buildExecutionLog(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, isCrossProject, locale } = p;
  const h = {
    project: t("reports.dimensions.project"),
    testCase: t("reports.dimensions.testCase"),
    testRun: t("reports.dimensions.testRun"),
    status: t("common.actions.status"),
    executedBy: t("common.fields.executedBy"),
    executedAt: t("common.fields.executedAt"),
    duration: t("common.fields.duration"),
  };
  // Export the top-level execution rows (steps are nested sub-rows in the UI).
  return rows.map((r: any) => {
    const row: CsvRow = {};
    if (isCrossProject) row[h.project] = r.project?.name ?? "";
    row[h.testCase] = r.testCaseName ?? "";
    row[h.testRun] = r.testRunName ?? "";
    row[h.status] = r.status?.name ?? "";
    row[h.executedBy] = r.executedBy?.name ?? "";
    row[h.executedAt] = fmtDateTime(r.executedAt);
    row[h.duration] = fmtDuration(r.elapsed, true, locale);
    return row;
  });
}

function buildAutomationTrends(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, projects = [] } = p;
  const hPeriod = t("reports.dimensions.period");
  const single = projects.length <= 1;
  return rows.map((r: any) => {
    const row: CsvRow = {};
    row[hPeriod] =
      r.periodStart && r.periodEnd
        ? `${fmtDateUtc(r.periodStart)} – ${fmtDateUtc(r.periodEnd)}`
        : fmtDateUtc(r.periodStart);
    for (const project of projects) {
      const prefix = project.name.replace(/\s+/g, "");
      const tag = single ? "" : `${project.name} `;
      row[`${tag}${t("reports.metrics.automatedCount")}`] =
        r[`${prefix}_automated`] ?? 0;
      row[`${tag}${t("reports.metrics.manualCount")}`] =
        r[`${prefix}_manual`] ?? 0;
      row[`${tag}${t("reports.metrics.totalCount")}`] =
        r[`${prefix}_total`] ?? 0;
      // One decimal, matching the on-screen column (useAutomationTrendsColumns
      // renders `value.toFixed(1)`). Rounding to a whole number here collapsed
      // every sub-1% automation rate to "0%", which reads as "no automation at
      // all" on a project that has some.
      row[`${tag}% ${t("common.fields.automated")}`] = fmtPercent(
        r[`${prefix}_percentAutomated`],
        1
      );
    }
    return row;
  });
}

// custom / standard reports (dynamic dimensions + metrics) -----------------

function metricAccessor(metric: {
  value: string;
  label: string;
  apiLabel?: string;
}): string {
  if (metric.apiLabel) return metric.apiLabel;
  switch (metric.value) {
    case "testResults":
      return "Test Results Count";
    case "passRate":
      return "Pass Rate (%)";
    case "avgElapsedTime":
      return "Avg. Elapsed Time";
    case "totalElapsedTime":
      return "Total Elapsed Time";
    case "testRuns":
      return "Test Runs Count";
    case "testCases":
      return "Test Cases Count";
    default:
      return metric.label;
  }
}

// Unit metadata wins; the id/label heuristics only classify metrics that
// aren't in the units map (custom presets).
function isRateMetric(m: { value: string; label: string }): boolean {
  const unit = metricUnit(m.value);
  if (unit !== undefined) return unit === "percent";
  return /rate|percentage|%/i.test(m.value) || /rate|%/i.test(m.label);
}

function isTimeMetric(m: { value: string; label: string }): boolean {
  const unit = metricUnit(m.value);
  if (unit !== undefined) return unit === "seconds";
  return (
    /time|duration|elapsed/i.test(m.value) ||
    /time|duration|elapsed/i.test(m.label)
  );
}

function dimensionValue(row: any, dimId: string): string {
  const v = row[dimId];
  if (v == null) return "";
  if (dimId === "date") {
    const d = typeof v === "object" ? (v.executedAt ?? v.createdAt ?? null) : v;
    // The backend normalizes grouping dates to UTC midnight; the on-screen
    // column reads UTC components. Use UTC here too, otherwise users behind
    // UTC see every date shifted back a day.
    return fmtDateUtc(d);
  }
  if (typeof v === "object") {
    return v.name ?? v.title ?? v.templateName ?? v.email ?? "";
  }
  return String(v);
}

function buildCustom(p: BuildReportCsvParams): CsvRow[] {
  const { rows, dimensions = [], metrics = [], locale } = p;
  return rows.map((r: any) => {
    const row: CsvRow = {};
    for (const dim of dimensions) {
      row[dim.label] = dimensionValue(r, dim.value);
    }
    for (const metric of metrics) {
      const raw = r[metricAccessor(metric)];
      const num = typeof raw === "number" ? raw : Number(raw);
      let value: string | number;
      if (raw == null || isNaN(num)) {
        value = "";
      } else if (isRateMetric(metric)) {
        value = `${num.toFixed(1)}%`;
      } else if (isTimeMetric(metric)) {
        // Custom-report elapsed metrics (avg/total) are in seconds, matching
        // the on-screen leaf cell. Empty value → blank cell (the screen's "-"
        // placeholder would get a leading apostrophe from papaparse's
        // formula-injection escaping, and blank is the right CSV
        // representation of "no data" anyway).
        value =
          num === 0
            ? ""
            : toHumanReadable(num, {
                isSeconds: true,
                locale,
                largest: 2,
                round: true,
              });
      } else {
        value = num;
      }
      row[metric.label] = value;
    }
    return row;
  });
}

/**
 * Build the CSV rows for a report. Dispatches to a per-type transform; falls
 * back to the dimension/metric-driven custom builder.
 */
export function buildReportCsvRows(p: BuildReportCsvParams): CsvRow[] {
  if (!p.rows || p.rows.length === 0) return [];
  switch (getBaseReportType(p.reportType)) {
    case "flaky-tests":
      return buildFlakyTests(p);
    case "test-case-health":
      return buildTestCaseHealth(p);
    case "issue-test-coverage":
      return buildIssueTestCoverage(p);
    case "execution-log":
      return buildExecutionLog(p);
    case "automation-trends":
      return buildAutomationTrends(p);
    default:
      return buildCustom(p);
  }
}

/** Filename like `flaky-tests-2026-06-11-141530.csv`. */
export function reportCsvFileName(reportType: string, now: Date): string {
  return `${reportType}-${format(now, "yyyy-MM-dd-HHmmss")}.csv`;
}
