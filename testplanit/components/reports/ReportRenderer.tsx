"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { DataTable } from "@/components/tables/DataTable";
import { ReportChart } from "@/components/dataVisualizations/ReportChart";
import { PaginationComponent } from "~/components/tables/Pagination";
import { PaginationInfo } from "~/components/tables/PaginationControls";
import { defaultPageSizeOptions } from "~/lib/contexts/PaginationContext";
import { DateFormatter } from "@/components/DateFormatter";
import { useReportColumns } from "~/hooks/useReportColumns";
import { useAutomationTrendsColumns } from "~/hooks/useAutomationTrendsColumns";
import { useFlakyTestsColumns } from "~/hooks/useFlakyTestsColumns";
import { useTestCaseHealthColumns } from "~/hooks/useTestCaseHealthColumns";
import { useIssueTestCoverageSummaryColumns } from "~/hooks/useIssueTestCoverageColumns";
import { ColumnDef, VisibilityState, ExpandedState, OnChangeFn } from "@tanstack/react-table";

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

  // Pagination
  currentPage: number;
  pageSize: number | "All";
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number | "All") => void;

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
  staleDaysThreshold,
  minExecutionsForRate,
  lookbackDays,
  dateGrouping = "weekly",
  totalFlakyTests,
  currentPage,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
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
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const tReports = useTranslations("reports.ui");

  // Extract dimension and metric IDs for useReportColumns
  const dimensionIds = useMemo(() => dimensions.map((d) => d.value), [dimensions]);
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

  // Choose which columns to use based on report type (same logic as ReportBuilder)
  // If preGeneratedColumns are provided (e.g., from ReportBuilder with drill-down handlers), use those
  const generatedColumns =
    reportType === "automation-trends" || reportType === "cross-project-automation-trends"
      ? automationTrendsColumns
      : reportType === "flaky-tests" || reportType === "cross-project-flaky-tests"
        ? flakyTestsColumns
        : reportType === "test-case-health" || reportType === "cross-project-test-case-health"
          ? testCaseHealthColumns
          : reportType === "issue-test-coverage" || reportType === "cross-project-issue-test-coverage"
            ? issueTestCoverageColumns
            : standardColumns;

  const columns = preGeneratedColumns || generatedColumns;

  // Determine which reports are pre-built
  const isAutomationTrends =
    reportType === "automation-trends" || reportType === "cross-project-automation-trends";
  const isFlakyTests =
    reportType === "flaky-tests" || reportType === "cross-project-flaky-tests";
  const isTestCaseHealth =
    reportType === "test-case-health" || reportType === "cross-project-test-case-health";
  const isIssueTestCoverage =
    reportType === "issue-test-coverage" || reportType === "cross-project-issue-test-coverage";

  // Calculate pagination
  const startIndex =
    pageSize === "All" ? 1 : (currentPage - 1) * pageSize + 1;
  const endIndex =
    pageSize === "All"
      ? totalCount
      : Math.min(currentPage * pageSize, totalCount);

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
              ? (1 - Math.pow(decayFactor, executions.length)) / (1 - decayFactor)
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

    // For Test Case Health and Issue Test Coverage, pass all data for accurate summaries
    const chartResults =
      isTestCaseHealth || isIssueTestCoverage ? dataForChart : limitedChartData;

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
      isTruncated: isTestCaseHealth || isIssueTestCoverage ? false : isTruncated,
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
  ]);

  if (!results || results.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{tReports("noResultsFound")}</CardTitle>
            <CardDescription>
              {dimensionIds.length > 0 && metricIds.length > 0
                ? tReports("noDataMatchingCriteria")
                : isAutomationTrends || isFlakyTests || isTestCaseHealth || isIssueTestCoverage
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
      autoSaveId={readOnly ? "shared-report-panels" : "report-builder-results-panels"}
    >
      {/* Visualization Panel */}
      <ResizablePanel
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
                {reportSummary && <CardDescription>{reportSummary}</CardDescription>}
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
                      shown: MAX_CHART_DATA_POINTS.toLocaleString(),
                      total: memoizedChart.totalDataPoints.toLocaleString(),
                    })}
                  </p>
                )}
              </div>
              {headerActions}
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-4rem)] p-6 flex flex-col">
            <div className="flex-1 min-h-0 w-full">
              {memoizedChart.chart}
            </div>
          </CardContent>
        </Card>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Results Table Panel */}
      <ResizablePanel
        defaultSize={50}
        minSize={20}
        collapsedSize={0}
        collapsible
      >
        <Card className="h-full rounded-none border-0 overflow-hidden">
          <CardHeader className="pt-2 pb-2">
            <div className="flex flex-row items-end justify-between">
              <CardTitle>{tCommon("results")}</CardTitle>
              {totalCount > 0 && (
                <div className="flex flex-col items-end">
                  <div className="justify-end">
                    <PaginationInfo
                      startIndex={startIndex}
                      endIndex={endIndex}
                      totalRows={totalCount}
                      searchString=""
                      pageSize={pageSize}
                      pageSizeOptions={defaultPageSizeOptions}
                      handlePageSizeChange={onPageSizeChange}
                    />
                  </div>
                  {pageSize !== "All" && totalCount > (pageSize as number) && (
                    <div className="justify-end -mx-4">
                      <PaginationComponent
                        currentPage={currentPage}
                        totalPages={Math.ceil(totalCount / (pageSize as number))}
                        onPageChange={onPageChange}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-4rem)] overflow-y-auto p-6 pt-0">
            <DataTable
              columns={columns as ColumnDef<any>[]}
              data={results || []}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={onColumnVisibilityChange}
              sortConfig={sortConfig || undefined}
              onSortChange={onSortChange}
              grouping={grouping}
              onGroupingChange={onGroupingChange}
              expanded={expanded}
              onExpandedChange={onExpandedChange}
            />
          </CardContent>
        </Card>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
