"use client";

import { AutomationCandidatesReportPreset } from "@/components/automationCandidates/AutomationCandidatesReportPreset";
import { ReportChart } from "@/components/dataVisualizations/ReportChart";
import { DateFormatter } from "@/components/DateFormatter";
import { MatrixReportPreset } from "@/components/matrix/MatrixReportPreset";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  ColumnDef,
  ExpandedState,
  OnChangeFn,
  VisibilityState,
} from "@tanstack/react-table";
import { Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { useAutomationTrendsColumns } from "~/hooks/useAutomationTrendsColumns";
import { useExecutionLogColumns } from "~/hooks/useExecutionLogColumns";
import { useFlakyTestsColumns } from "~/hooks/useFlakyTestsColumns";
import { useIssueTestCoverageSummaryColumns } from "~/hooks/useIssueTestCoverageColumns";
import { useReportColumns } from "~/hooks/useReportColumns";
import { useTestCaseHealthColumns } from "~/hooks/useTestCaseHealthColumns";

// Helper functions for report type matching
// These helpers allow us to write code that works with both project-level and cross-project variants
// without having to explicitly check for both (e.g., "automation-trends" and "cross-project-automation-trends")

/**
 * Strips the "cross-project-" prefix from a report type ID
 * @example getBaseReportType("cross-project-automation-trends") => "automation-trends"
 * @example getBaseReportType("automation-trends") => "automation-trends"
 */
function getBaseReportType(reportType: string): string {
  return reportType.replace(/^cross-project-/, "");
}

/**
 * Checks if a report type matches a base type (handles both project and cross-project variants)
 * @example matchesReportType("automation-trends", "automation-trends") => true
 * @example matchesReportType("cross-project-automation-trends", "automation-trends") => true
 * @example matchesReportType("flaky-tests", "automation-trends") => false
 */
function matchesReportType(reportType: string, baseType: string): boolean {
  return getBaseReportType(reportType) === baseType;
}

interface ReportRendererProps {
  // Data
  results: any[];
  chartData?: any[];

  // Config
  reportType: string;
  dimensions?: Array<{ value: string; label: string }>;
  metrics?: Array<{ value: string; label: string }>;

  // Pre-generated columns (optional - if provided, these will be used instead of generating new ones)
  // This is useful for ReportBuilder which needs columns with drill-down handlers
  preGeneratedColumns?: ColumnDef<any>[];

  // Project info
  projectId?: number | string;
  mode?: "project" | "cross-project";
  projects?: Array<{ id: number; name: string }>;

  // Special report parameters
  consecutiveRuns?: number;
  staleDaysThreshold?: number;
  minExecutionsForRate?: number;
  lookbackDays?: number;
  dateGrouping?: string;
  totalFlakyTests?: number;

  // Iteration-matrix shared-link payload: when the share endpoint pre-fetches
  // the matrix axes server-side, this carries them through so MatrixReportPreset
  // can render without re-fetching (the matrix has no public-share aggregate
  // endpoint). `cells` arrives as Array<[key, value]> per JSON-serialization
  // and is reconstructed into a Map by MatrixReportPreset.
  matrixAxes?: {
    caseAxis: any[];
    configAxis: any[];
    cells: Array<[string, any]>;
    cellCount: number;
    statusMap: Record<number, any>;
  };

  // Automation-candidates shared-link payload: the share endpoint reads the
  // latest persisted snapshot directly from the DB and passes it through so
  // the preset renders without firing a (streaming, auth-gated) generation.
  // Snapshot reports are inherently view-only when shared — there's no
  // "regenerate this for a public viewer" interaction.
  automationCandidatesSnapshot?: any;

  // Results count + infinite scroll. `loadedCount` is how many rows are
  // currently in `results` (the "X" in "Showing X of Y"); `totalCount` is the
  // full match count. For full-set reports loadedCount === totalCount and
  // hasMore is false; execution-log fetches more on scroll.
  loadedCount: number;
  totalCount: number;
  hasMore?: boolean;
  isLoading?: boolean;
  onLoadMore?: () => void;
  loadMoreError?: boolean;
  onRetryLoadMore?: () => void;

  // CSV export (rendered in the results header when provided)
  onExportCsv?: () => void;
  isExportingCsv?: boolean;

  // Sorting
  sortConfig?: { column: string; direction: "asc" | "desc" } | null;
  onSortChange: (columnId: string) => void;

  // Column visibility
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: (visibility: VisibilityState) => void;

  // Grouping/Expansion (for hierarchical data)
  grouping?: string[];
  onGroupingChange?: OnChangeFn<string[]>;
  expanded?: ExpandedState;
  onExpandedChange?: OnChangeFn<ExpandedState>;

  // Display options
  reportSummary?: string;
  reportGeneratedAt?: Date | string;
  userTimezone?: string;

  // Read-only mode (for shared links - hides share button, etc.)
  readOnly?: boolean;

  // Children (for ShareButton in ReportBuilder, omitted in shared view)
  headerActions?: React.ReactNode;
}

export function ReportRenderer({
  results,
  chartData,
  reportType,
  dimensions = [],
  metrics = [],
  preGeneratedColumns,
  projectId,
  mode = "project",
  projects = [],
  consecutiveRuns = 5,
  staleDaysThreshold: _staleDaysThreshold,
  minExecutionsForRate: _minExecutionsForRate,
  lookbackDays: _lookbackDays,
  dateGrouping = "weekly",
  totalFlakyTests,
  matrixAxes,
  automationCandidatesSnapshot,
  loadedCount,
  totalCount,
  hasMore = false,
  isLoading = false,
  onLoadMore,
  loadMoreError = false,
  onRetryLoadMore,
  onExportCsv,
  isExportingCsv = false,
  sortConfig,
  onSortChange,
  columnVisibility,
  onColumnVisibilityChange,
  grouping,
  onGroupingChange,
  expanded,
  onExpandedChange,
  reportSummary,
  reportGeneratedAt,
  userTimezone,
  readOnly = false,
  headerActions,
}: ReportRendererProps) {
  const locale = useLocale();
  const tCommon = useTranslations("common");
  const tReports = useTranslations("reports.ui");

  // Extract dimension and metric IDs for useReportColumns
  const dimensionIds = useMemo(
    () => dimensions.map((d) => d.value),
    [dimensions]
  );
  const metricIds = useMemo(() => metrics.map((m) => m.value), [metrics]);

  // Generate columns using all the specialized hooks (only if not pre-generated)
  const standardColumns = useReportColumns(
    dimensionIds,
    metricIds,
    dimensions,
    metrics,
    undefined, // No drill-down for shared reports
    projectId
  );

  const automationTrendsColumns = useAutomationTrendsColumns(
    projects,
    dateGrouping
  );

  const flakyTestsColumns = useFlakyTestsColumns(
    consecutiveRuns,
    projectId,
    dimensionIds,
    mode === "cross-project"
  );

  const testCaseHealthColumns = useTestCaseHealthColumns(
    projectId,
    dimensionIds,
    mode === "cross-project"
  );

  const issueTestCoverageColumns = useIssueTestCoverageSummaryColumns(
    projectId,
    dimensionIds,
    mode === "cross-project"
  );

  const executionLogColumns = useExecutionLogColumns(
    projectId,
    mode === "cross-project"
  );

  // Choose which columns to use based on report type (same logic as ReportBuilder)
  // If preGeneratedColumns are provided (e.g., from ReportBuilder with drill-down handlers), use those
  const generatedColumns = matchesReportType(reportType, "automation-trends")
    ? automationTrendsColumns
    : matchesReportType(reportType, "flaky-tests")
      ? flakyTestsColumns
      : matchesReportType(reportType, "test-case-health")
        ? testCaseHealthColumns
        : matchesReportType(reportType, "issue-test-coverage")
          ? issueTestCoverageColumns
          : matchesReportType(reportType, "execution-log")
            ? executionLogColumns
            : standardColumns;

  const columns = preGeneratedColumns || generatedColumns;

  // Determine which reports are pre-built
  const isAutomationTrends = matchesReportType(reportType, "automation-trends");
  const isFlakyTests = matchesReportType(reportType, "flaky-tests");
  const isTestCaseHealth = matchesReportType(reportType, "test-case-health");
  const isIssueTestCoverage = matchesReportType(
    reportType,
    "issue-test-coverage"
  );
  const isExecutionLog = matchesReportType(reportType, "execution-log");
  const isIterationMatrix = matchesReportType(reportType, "iteration-matrix");
  const isAutomationCandidates = matchesReportType(
    reportType,
    "automation-candidates"
  );

  // Maximum number of data points to render in charts
  const MAX_CHART_DATA_POINTS = 50;

  // Memoize the chart component
  const memoizedChart = useMemo(() => {
    const dataForChart = chartData || results;

    // Check if we should show a chart
    if (
      !dataForChart ||
      dataForChart.length === 0 ||
      (!isAutomationTrends &&
        !isFlakyTests &&
        !isTestCaseHealth &&
        !isIssueTestCoverage &&
        !isExecutionLog &&
        (dimensionIds.length === 0 || metricIds.length === 0))
    ) {
      return { chart: null, isTruncated: false, totalDataPoints: 0 };
    }

    // For flaky tests, prioritize tests with highest attention score
    let dataToLimit = dataForChart;
    if (isFlakyTests && Array.isArray(dataForChart)) {
      const decayFactor = 0.7;
      dataToLimit = dataForChart
        .map((test: any) => {
          const executions = test.executions || [];
          let recencyScore = 0;
          let weight = 1;

          for (const execution of executions) {
            if (!execution.isSuccess) {
              recencyScore += weight;
            }
            weight *= decayFactor;
          }

          const maxScore =
            executions.length > 0
              ? (1 - Math.pow(decayFactor, executions.length)) /
                (1 - decayFactor)
              : 1;
          const normalizedRecency = maxScore > 0 ? recencyScore / maxScore : 0;

          const normalizedFlips = test.flipCount / (consecutiveRuns - 1 || 1);
          const priorityScore = normalizedFlips * 0.5 + normalizedRecency * 0.5;

          return { ...test, _priorityScore: priorityScore };
        })
        .sort((a: any, b: any) => b._priorityScore - a._priorityScore);
    }

    const isTruncated = dataToLimit.length > MAX_CHART_DATA_POINTS;
    const limitedChartData = isTruncated
      ? dataToLimit.slice(0, MAX_CHART_DATA_POINTS)
      : dataToLimit;

    // For Test Case Health, Issue Test Coverage, and Execution Log, pass all data for accurate summaries
    const chartResults =
      isTestCaseHealth || isIssueTestCoverage || isExecutionLog
        ? dataForChart
        : limitedChartData;

    return {
      chart: (
        <ReportChart
          results={chartResults}
          dimensions={dimensions}
          metrics={metrics}
          reportType={reportType}
          projects={projects}
          consecutiveRuns={consecutiveRuns}
          totalFlakyTests={totalFlakyTests}
          projectId={projectId}
        />
      ),
      isTruncated:
        isTestCaseHealth || isIssueTestCoverage ? false : isTruncated,
      totalDataPoints: dataForChart.length,
    };
  }, [
    chartData,
    results,
    reportType,
    dimensions,
    metrics,
    projects,
    consecutiveRuns,
    totalFlakyTests,
    projectId,
    dimensionIds.length,
    metricIds.length,
    isAutomationTrends,
    isFlakyTests,
    isTestCaseHealth,
    isIssueTestCoverage,
    isExecutionLog,
  ]);

  // Iteration Matrix preset bypasses the chart/table pipeline entirely.
  // MatrixReportPreset is self-fetching (`useMatrixAggregation` +
  // `useMatrixFilters`) so it inherits the dedicated `/projects/[id]/matrix`
  // page's cell-cap handling, filter UX, and URL-backed share state. The
  // ReportBuilder shell still owns title / save / share chrome; the data
  // fetch path is independent of the report-builder POST flow.
  if (isIterationMatrix && projectId) {
    return (
      <MatrixReportPreset
        projectId={
          typeof projectId === "string" ? parseInt(projectId, 10) : projectId
        }
        prefetchedAxes={matrixAxes}
        readOnly={readOnly}
        headerActions={headerActions}
      />
    );
  }

  // Automation Candidates is a snapshot-style LLM report — fundamentally
  // different shape from query-driven aggregations (ranked list with per-row
  // rationale + Generate/History/Delete chrome). Mirrors the matrix preset's
  // self-contained early-return pattern.
  if (isAutomationCandidates && projectId) {
    return (
      <AutomationCandidatesReportPreset
        projectId={
          typeof projectId === "string" ? parseInt(projectId, 10) : projectId
        }
        readOnly={readOnly}
        headerActions={headerActions}
        prefetchedSnapshot={automationCandidatesSnapshot}
      />
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{tReports("noResultsFound")}</CardTitle>
            <CardDescription>
              {dimensionIds.length > 0 && metricIds.length > 0
                ? tReports("noDataMatchingCriteria")
                : isAutomationTrends ||
                    isFlakyTests ||
                    isTestCaseHealth ||
                    isIssueTestCoverage ||
                    isExecutionLog
                  ? tReports("noDataAvailable")
                  : tReports("selectAtLeastOneDimensionAndMetric")}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      direction="vertical"
      className="h-full min-h-[calc(100vh-14rem)]"
      autoSaveId={
        readOnly ? "shared-report-panels" : "report-builder-results-panels"
      }
    >
      {/* Visualization Panel */}
      <ResizablePanel
        id="report-results-top"
        order={1}
        defaultSize={50}
        minSize={20}
        collapsedSize={0}
        collapsible
      >
        <Card className="h-full rounded-none border-0 overflow-hidden">
          <CardHeader className="pt-2 pb-2">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <CardTitle>{tCommon("visualization")}</CardTitle>
                {reportSummary && (
                  <CardDescription>{reportSummary}</CardDescription>
                )}
                {reportGeneratedAt && (
                  <p className="text-xs text-muted-foreground">
                    {tReports("generatedAt")}{" "}
                    <DateFormatter
                      date={reportGeneratedAt}
                      formatString="PPp"
                      timezone={userTimezone}
                    />
                  </p>
                )}
                {memoizedChart.isTruncated && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {tReports("chartDataTruncated.message", {
                      shown: MAX_CHART_DATA_POINTS.toLocaleString(locale),
                      total:
                        memoizedChart.totalDataPoints.toLocaleString(locale),
                    })}
                  </p>
                )}
              </div>
              {headerActions}
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-4rem)] p-6 flex flex-col">
            <div className="flex-1 min-h-0 w-full">{memoizedChart.chart}</div>
          </CardContent>
        </Card>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Results Table Panel */}
      <ResizablePanel
        id="report-results-bottom"
        order={2}
        defaultSize={50}
        minSize={20}
        collapsedSize={0}
        collapsible
      >
        <Card className="h-full rounded-none border-0 overflow-hidden">
          <CardHeader className="pt-2 pb-2">
            <div className="flex flex-row items-end justify-between gap-4">
              <CardTitle>{tCommon("results")}</CardTitle>
              <div className="flex items-center gap-3">
                {totalCount > 0 && (
                  <div
                    className="text-sm text-muted-foreground"
                    data-testid="report-results-summary"
                  >
                    {tCommon("pagination.showing")} {loadedCount}{" "}
                    {tCommon("of")} {totalCount} {tCommon("results")}
                  </div>
                )}
                {onExportCsv && totalCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onExportCsv}
                    disabled={isExportingCsv}
                    data-testid="report-export-csv-button"
                  >
                    <Download className="h-4 w-4" />
                    {tReports("exportCsv")}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-4rem)] p-6 pt-0">
            <VirtualizedDataTable
              columns={columns as ColumnDef<any>[]}
              data={results}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={onColumnVisibilityChange}
              columnSizingStorageKey={`report:${getBaseReportType(reportType)}`}
              sortConfig={sortConfig || undefined}
              onSortChange={onSortChange}
              grouping={grouping}
              onGroupingChange={onGroupingChange}
              expanded={expanded}
              onExpandedChange={onExpandedChange}
              getSubRows={
                isExecutionLog
                  ? (row: any) => row.steps as any[] | undefined
                  : undefined
              }
              subRowsLabel={
                isExecutionLog
                  ? tCommon("fields.steps").toLowerCase()
                  : undefined
              }
              hasMore={hasMore}
              isLoading={isLoading}
              onLoadMore={onLoadMore}
              loadMoreError={loadMoreError}
              onRetryLoadMore={onRetryLoadMore}
            />
          </CardContent>
        </Card>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
