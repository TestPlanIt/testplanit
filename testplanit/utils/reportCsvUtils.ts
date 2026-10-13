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
import { ROOT_DIRECTORY } from "~/utils/codePinCoverageShared";
import { formatRequirementCellText } from "~/utils/issueDisplayText";
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
  const hProject = t("common.fields.project");
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
    project: t("common.fields.project"),
    testCase: t("reports.dimensions.testCase"),
    status: t("reports.ui.testCaseHealth.status"),
    stale: t("reports.ui.testCaseHealth.healthStatus.stale"),
    score: t("reports.ui.testCaseHealth.healthScore"),
    lastExecuted: t("reports.ui.testCaseHealth.lastExecuted"),
    executions: t("reports.ui.testCaseHealth.executions"),
    passRate: t("common.fields.passRate"),
  };
  const never = t("common.never");
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

const IMPACT_TRIGGER_KEY: Record<string, string> = {
  manual: "common.fields.manual",
  pull_request: "runs.impact.pull.label",
  push: "reports.ui.impactAnalysis.triggerPush",
};
const IMPACT_OUTCOME_KEY: Record<string, string> = {
  failed: "reports.metrics.failed",
  passed: "reports.metrics.passed",
  not_executed: "reports.ui.impactAnalysis.outcomeNotExecuted",
  no_run: "reports.ui.impactAnalysis.outcomeNoRun",
};

// Same "8s" / "1m 5s" shape the history table's Duration cell shows.
function fmtSecondsLikeTable(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  const seconds = Math.round(ms / 1000);
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
}

function buildImpactAnalysis(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, isCrossProject } = p;
  const h = {
    project: t("common.fields.project"),
    started: t("common.fields.started"),
    repository: t("common.pageTitles.repository"),
    trigger: t("reports.dimensions.trigger"),
    commits: t("runs.impact.pick.modeCommits"),
    files: t("reports.ui.impactAnalysis.changedFiles"),
    pinned: t("runs.impact.affected.tierPinned"),
    affected: t("runs.impact.affected.tierAffected"),
    related: t("runs.impact.affected.tierRelated"),
    accepted: t("reports.ui.impactAnalysis.accepted"),
    testRun: t("common.actions.junit.import.testRun.label"),
    outcome: t("reports.dimensions.outcome"),
    passed: t("reports.metrics.passed"),
    failed: t("reports.metrics.failed"),
    duration: t("common.fields.duration"),
    creator: t("reports.dimensions.creator"),
  };
  // Columns follow the table (hidden-by-default ones included); the trigger
  // cell's sub-label (PR title, push summary) rides along in the same column.
  return rows.map((r: any) => {
    const row: CsvRow = {};
    if (isCrossProject) row[h.project] = r.project?.name ?? "";
    row[h.started] = r.createdAt ? fmtDateTime(r.createdAt) : "";
    row[h.repository] = r.repository?.name ?? "";
    const triggerKind = IMPACT_TRIGGER_KEY[r.trigger]
      ? t(IMPACT_TRIGGER_KEY[r.trigger])
      : (r.trigger ?? "");
    row[h.trigger] = r.triggerLabel
      ? `${triggerKind}: ${r.triggerLabel}`
      : triggerKind;
    row[h.commits] = `${r.baseRef ?? ""}..${r.headRef ?? ""}`;
    row[h.files] = r.fileCount ?? 0;
    row[h.pinned] = r.pinnedCaseCount ?? 0;
    row[h.affected] = r.affectedCaseCount ?? 0;
    row[h.related] = r.relatedCaseCount ?? 0;
    row[h.accepted] = r.acceptedCaseCount ?? 0;
    row[h.testRun] = r.testRun?.name ?? "";
    row[h.outcome] = IMPACT_OUTCOME_KEY[r.outcome]
      ? t(IMPACT_OUTCOME_KEY[r.outcome])
      : (r.outcome ?? "");
    row[h.passed] = r.runPassedCount ?? 0;
    row[h.failed] = r.runFailedCount ?? 0;
    row[h.duration] = fmtSecondsLikeTable(r.durationMs);
    row[h.creator] = r.createdBy?.name ?? "";
    return row;
  });
}

function buildCodePinCoverage(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, isCrossProject } = p;
  const h = {
    project: t("common.fields.project"),
    repository: t("common.pageTitles.repository"),
    directory: t("reports.ui.codePinCoverage.directory"),
    pins: t("repository.codePins.title"),
    file: t("repository.codePins.kindFile"),
    range: t("repository.codePins.kindRange"),
    symbol: t("repository.codePins.kindSymbol"),
    glob: t("repository.codePins.kindGlob"),
    cases: t("reports.ui.codePinCoverage.casesWithPins"),
    stale: t("reports.ui.codePinCoverage.stalePins"),
    uncovered: t("reports.ui.codePinCoverage.uncoveredFiles"),
    analyses: t("reports.ui.impactAnalysis.stats.analyses"),
  };
  return rows.map((r: any) => {
    const row: CsvRow = {};
    if (isCrossProject) row[h.project] = r.project?.name ?? "";
    row[h.repository] = r.repository?.name ?? "";
    row[h.directory] =
      r.directory === ROOT_DIRECTORY
        ? t("reports.ui.codePinCoverage.rootDirectory")
        : (r.directory ?? "");
    row[h.pins] = r.pinCount ?? 0;
    row[h.file] = r.kindCounts?.FILE ?? 0;
    row[h.range] = r.kindCounts?.RANGE ?? 0;
    row[h.symbol] = r.kindCounts?.SYMBOL ?? 0;
    row[h.glob] = r.kindCounts?.GLOB ?? 0;
    row[h.cases] = r.caseCount ?? 0;
    row[h.stale] = r.stalePinCount ?? 0;
    row[h.uncovered] = r.uncoveredFileCount ?? 0;
    row[h.analyses] = r.uncoveredAnalysisCount ?? 0;
    return row;
  });
}

function buildIssueTestCoverage(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, isCrossProject } = p;
  const h = {
    project: t("common.fields.project"),
    issue: t("reports.ui.issueTestCoverage.issue"),
    testCase: t("reports.ui.issueTestCoverage.testCase"),
    status: t("common.actions.status"),
    priority: t("common.fields.priority"),
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

function buildRequirementCoverageGaps(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, isCrossProject } = p;
  const h = {
    requirementProject: t("reports.ui.requirementCoverage.requirementProject"),
    requirement: t("reports.ui.requirementCoverage.requirement"),
    path: t("reports.ui.requirementCoverage.path"),
    priority: t("common.fields.priority"),
    status: t("common.actions.status"),
    coverage: t("requirements.coverage.title"),
    linkedCases: t("reports.ui.requirementCoverage.linkedCases"),
    uncoveredSince: t("reports.ui.requirementCoverage.uncoveredSince"),
  };
  const coverageLabels: Record<string, string> = {
    UNCOVERED: t("requirements.coverage.uncovered"),
    NOT_RUN: t("requirements.coverage.statusNotRun"),
  };
  return rows.map((r: any) => {
    const row: CsvRow = {};
    // Only the cross-project variant has more than one requirement project;
    // on the project-scoped report the column would be a constant.
    if (isCrossProject) {
      row[h.requirementProject] = r.requirementProjectName ?? "";
    }
    row[h.requirement] = formatRequirementCellText(r);
    row[h.path] = r.requirementParentPath ?? "";
    row[h.priority] = r.requirementPriority ?? "";
    row[h.status] = r.requirementStatus ?? "";
    row[h.coverage] = coverageLabels[r.coverageStatus] ?? "";
    row[h.linkedCases] = r.linkedCases ?? 0;
    row[h.uncoveredSince] = fmtDateTime(r.requirementCreatedAt);
    return row;
  });
}

function buildRequirementTraceability(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, isCrossProject } = p;
  const h = {
    requirementProject: t("reports.ui.requirementCoverage.requirementProject"),
    requirement: t("reports.ui.requirementCoverage.requirement"),
    path: t("reports.ui.requirementCoverage.path"),
    priority: t("common.fields.priority"),
    status: t("common.actions.status"),
    coverage: t("requirements.coverage.title"),
    testCase: t("reports.ui.requirementCoverage.testCase"),
    result: t("common.fields.resultStatus"),
    executedAt: t("common.fields.executedAt"),
    project: t("common.fields.project"),
  };
  const uncovered = t("reports.ui.requirementCoverage.uncovered");
  const notRun = t("reports.ui.requirementCoverage.notRun");
  // The requirement's classified coverage state, labeled with the same
  // `requirements.coverage.*` vocabulary the tree and the table column use.
  const coverageLabels: Record<string, string> = {
    UNCOVERED: t("requirements.coverage.uncovered"),
    PASSED: t("requirements.coverage.statusPassed"),
    FAILED: t("requirements.coverage.statusFailed"),
    NOT_RUN: t("requirements.coverage.statusNotRun"),
  };
  // Mirrors the report table cell's three-way split
  // (`useRequirementCoverageReportColumns.tsx`): a null `testCaseId` is the
  // coverage gap and writes the localized "Uncovered" label; a linked case
  // with no `lastStatusName` has simply never run and writes "Not run" --
  // the two must never collapse to the same blank cell, or a real gap
  // becomes indistinguishable from a case that merely hasn't executed yet.
  return rows.map((r: any) => {
    const row: CsvRow = {};
    // The REQUIREMENT's project, only on the cross-project variant. The
    // `project` column below is a different thing — the covering case's
    // project — and ships on both variants.
    if (isCrossProject) {
      row[h.requirementProject] = r.requirementProjectName ?? "";
    }
    row[h.requirement] = formatRequirementCellText(r);
    row[h.path] = r.requirementParentPath ?? "";
    row[h.priority] = r.requirementPriority ?? "";
    row[h.status] = r.requirementStatus ?? "";
    row[h.coverage] = coverageLabels[r.coverageStatus] ?? "";
    row[h.testCase] = r.testCaseName ?? "";
    row[h.result] =
      r.testCaseId == null ? uncovered : (r.lastStatusName ?? notRun);
    row[h.executedAt] = fmtDateTime(r.lastExecutedAt);
    row[h.project] = r.caseProjectName ?? "";
    return row;
  });
}

function buildRequirementCoverageChanges(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t } = p;
  const h = {
    requirement: t("reports.ui.requirementCoverage.requirement"),
    path: t("reports.ui.requirementCoverage.path"),
    change: t("common.actions.change"),
    before: t("reports.ui.requirementCoverage.coverageBefore"),
    after: t("reports.ui.requirementCoverage.coverageAfter"),
    linkedBefore: t("reports.ui.requirementCoverage.linkedCasesBefore"),
    linkedAfter: t("reports.ui.requirementCoverage.linkedCasesAfter"),
    casesAdded: t("reports.ui.requirementCoverage.casesAdded"),
    casesRemoved: t("reports.ui.requirementCoverage.casesRemoved"),
    resultsChanged: t("reports.ui.requirementCoverage.resultsChanged"),
  };
  const coverageLabels: Record<string, string> = {
    UNCOVERED: t("requirements.coverage.uncovered"),
    PASSED: t("requirements.coverage.statusPassed"),
    FAILED: t("requirements.coverage.statusFailed"),
    NOT_RUN: t("requirements.coverage.statusNotRun"),
  };
  const changeLabels: Record<string, string> = {
    ADDED: t("reports.ui.requirementCoverage.changeAdded"),
    REMOVED: t("reports.ui.requirementCoverage.changeRemoved"),
    COVERAGE_CHANGED: t("reports.ui.requirementCoverage.changeCoverage"),
    LINKS_CHANGED: t("reports.ui.requirementCoverage.changeLinks"),
    RESULTS_CHANGED: t("reports.ui.requirementCoverage.changeResults"),
    UNCHANGED: t("reports.ui.requirementCoverage.changeUnchanged"),
  };
  // A missing side (no "before" for an added requirement, no "after" for
  // a removed one) writes an empty cell, distinct from any real state.
  return rows.map((r: any) => {
    const row: CsvRow = {};
    row[h.requirement] = formatRequirementCellText(r);
    row[h.path] = r.requirementParentPath ?? "";
    row[h.change] = changeLabels[r.changeKind] ?? "";
    row[h.before] = coverageLabels[r.previousCoverageStatus] ?? "";
    row[h.after] = coverageLabels[r.currentCoverageStatus] ?? "";
    row[h.linkedBefore] = r.previousLinkedCaseCount ?? "";
    row[h.linkedAfter] = r.currentLinkedCaseCount ?? "";
    row[h.casesAdded] = r.casesAdded ?? 0;
    row[h.casesRemoved] = r.casesRemoved ?? 0;
    row[h.resultsChanged] = r.resultsChanged ?? 0;
    return row;
  });
}

function buildExecutionLog(p: BuildReportCsvParams): CsvRow[] {
  const { rows, t, isCrossProject, locale } = p;
  const h = {
    project: t("common.fields.project"),
    testCase: t("reports.dimensions.testCase"),
    testRun: t("common.actions.junit.import.testRun.label"),
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
    case "impact-analysis":
      return buildImpactAnalysis(p);
    case "code-pin-coverage":
      return buildCodePinCoverage(p);
    case "requirement-coverage-gaps":
      return buildRequirementCoverageGaps(p);
    case "requirement-traceability":
      return buildRequirementTraceability(p);
    case "requirement-coverage-changes":
      return buildRequirementCoverageChanges(p);
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
