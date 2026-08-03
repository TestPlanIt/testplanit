"use client";
import { useLocale, useTranslations } from "next-intl";
import React from "react";
import { useIssueColors } from "~/hooks/useIssueColors";
import { toHumanReadable } from "~/utils/duration";
import { metricUnit } from "~/utils/metricUnits";
import { stringToColorCode } from "~/utils/stringToColorCode";
import { FlakyTestsBubbleChart } from "./FlakyTestsBubbleChart";
import { IssueTestCoverageChart } from "./IssueTestCoverageChart";
import RecentResultsDonut from "./RecentResultsDonut";
import { ReportBarChart } from "./ReportBarChart";
import { ReportGroupedBarChart } from "./ReportGroupedBarChart";
import { ReportLineChart } from "./ReportLineChart";
import { ReportMultiLineChart } from "./ReportMultiLineChart";
import { ReportMultiMetricBarChart } from "./ReportMultiMetricBarChart";
import {
  ReportSmallMultiplesGroupedBar,
  SmallMultipleData,
} from "./ReportSmallMultiplesGroupedBar";
import { ReportSunburstChart } from "./ReportSunburstChart";
import { TestCaseHealthChart } from "./TestCaseHealthChart";

// Helper functions for report type matching
/**
 * Strips the "cross-project-" prefix from a report type ID
 */
function getBaseReportType(reportType: string): string {
  return reportType.replace(/^cross-project-/, "");
}

/**
 * Checks if a report type matches a base type (handles both project and cross-project variants)
 */
function matchesReportType(reportType: string, baseType: string): boolean {
  return getBaseReportType(reportType) === baseType;
}

// Enums for chart types
export enum ChartType {
  Bar = "Bar",
  Line = "Line",
  GroupedBar = "GroupedBar",
  Sunburst = "Sunburst",
  MultiLine = "MultiLine",
  MultiMetricBar = "MultiMetricBar",
  SmallMultiplesGroupedBar = "SmallMultiplesGroupedBar",
  Donut = "Donut",
  None = "None",
}

// Standardized data formats
export interface SimpleChartDataPoint {
  id: string;
  name: string;
  value: number;
  formattedValue: string;
  color?: string;
  /** Human label distinct from the plotted X value — e.g. a milestone's name
   *  when its date is used on the X axis. Shown in tooltips when present. */
  label?: string;
}

export interface GroupedChartDataPoint {
  mainGroup: string;
  subGroup: string;
  value: number;
  formattedValue: string;
  color?: string;
}

export interface SunburstHierarchyNode {
  name: string;
  id: string;
  children?: SunburstHierarchyNode[];
  value?: number;
  formattedValue?: string;
  color?: string;
}

export interface MultiMetricDataPoint {
  group: string;
  metricName: string;
  value: number;
  formattedValue: string;
  color?: string;
}

export interface MultiLineSeries {
  name: string;
  values: {
    date: Date;
    value: number;
    formattedValue: string;
  }[];
  color?: string;
}

// Props for the main chart component
interface ReportChartProps {
  results: any[];
  dimensions: { value: string; label: string }[];
  metrics: { value: string; label: string; originalLabel?: string }[];
  reportType?: string; // Optional report type to handle special cases like automation-trends
  projects?: Array<{ id: number; name: string }>; // For automation trends report
  consecutiveRuns?: number; // For flaky tests report
  totalFlakyTests?: number; // Total count of flaky tests (for showing "not shown" count)
  projectId?: number | string; // Project ID for building links in charts
}

// Helper to determine chart type
const getChartType = (
  dimensions: { value: string; label: string }[],
  metrics: { value: string; label: string; originalLabel?: string }[],
  results: any[] = []
): ChartType => {
  const dimCount = dimensions.length;
  const metricCount = metrics.length;
  const firstDimType = dimensions[0]?.value;

  // Milestones are inherently time-based, so — like the "date" dimension — they
  // plot on a chronological (line) axis rather than as categories. Gate it on
  // the data actually carrying each milestone's date, so reports that don't
  // supply one keep their categorical charts instead of a broken time axis.
  const milestoneHasDates = results.some((r) => r?.milestone?.date != null);
  const isTimeDimension = (v?: string) =>
    v === "date" || (v === "milestone" && milestoneHasDates);

  // Categorical dimensions that render as donut / grouped bars. Milestone is
  // time-based (see isTimeDimension) when the data carries dates.
  const categoricalDims = [
    "status",
    "user",
    "folder",
    "creator",
    "template",
    "source",
    "state",
    "role",
    "session",
    "assignedTo",
    "issueType",
    "issueStatus",
    "issueTracker",
    "priority",
    "configuration",
  ];

  if (dimCount === 0 || metricCount === 0) {
    return ChartType.None;
  }

  // Check if any metric is a date metric - these shouldn't be visualized in charts
  const hasDateMetric = metrics.some((metric) => {
    const label = metric.label.toLowerCase();
    return (
      label.includes("date") ||
      metric.value === "lastActiveDate" ||
      metric.label === "Last Active Date"
    );
  });

  if (hasDateMetric) {
    return ChartType.None;
  }

  if (dimCount === 1) {
    if (metricCount === 1) {
      if (isTimeDimension(firstDimType)) {
        return ChartType.Line;
      }
      if (categoricalDims.includes(firstDimType)) {
        return ChartType.Donut;
      }
      return ChartType.Bar;
    } else {
      // 1 dimension, N metrics
      if (isTimeDimension(firstDimType)) {
        return ChartType.MultiLine;
      }
      return ChartType.MultiMetricBar;
    }
  }

  if (dimCount === 2) {
    if (metricCount === 1) {
      if (dimensions.some((d) => isTimeDimension(d.value))) {
        return ChartType.MultiLine;
      }
      // Use GroupedBar for two categorical dimensions, Sunburst for more complex hierarchies
      if (dimensions.every((d) => categoricalDims.includes(d.value))) {
        return ChartType.GroupedBar;
      }
      return ChartType.Sunburst;
    }
    if (metricCount >= 2) {
      return ChartType.SmallMultiplesGroupedBar;
    }
  }

  if (dimCount >= 3) {
    if (metricCount === 1) {
      if (dimensions.some((d) => isTimeDimension(d.value))) {
        return ChartType.MultiLine;
      }
      return ChartType.Sunburst;
    }
    if (metricCount >= 2) {
      return ChartType.SmallMultiplesGroupedBar;
    }
  }

  return ChartType.None; // Default to no chart if complex
};

// Helper to get the value for a dimension from a row
const getDimensionValue = (
  row: any,
  dimension: { value: string; label: string } | undefined
): string => {
  if (!dimension) return "Unknown";
  const dimValueKey = dimension.value;

  // First, try to get the dimension value object
  const dimValue = row[dimValueKey];

  // Handle date dimension specially
  if (dimValueKey === "date") {
    if (dimValue && typeof dimValue === "object" && dimValue !== null) {
      return dimValue.executedAt || dimValue.createdAt || "Unknown";
    }
    // Fallback: try to get date from label or other fields
    return row[dimension.label] ?? row[dimValueKey] ?? "Unknown";
  }

  // Milestones are time-based: their X value is the milestone's own date, so
  // charts lay them out chronologically. The name is preserved separately for
  // tooltips/labels (see getDimensionLabel).
  if (dimValueKey === "milestone" && dimValue?.date) {
    return String(dimValue.date);
  }

  // For non-date dimensions, extract the name from the dimension object
  if (dimValue && typeof dimValue === "object" && dimValue !== null) {
    // Dimension value is an object (e.g., { name: "Test Config 233", id: 233 })
    const name = dimValue.name;
    if (name) {
      return String(name);
    }
    // If no name, try id as fallback (but convert to string to avoid date parsing)
    if (dimValue.id !== undefined && dimValue.id !== null) {
      return String(dimValue.id);
    }
    return "Unknown";
  }

  // Fallback: try label or raw value
  return (
    row[dimension.label] ??
    (dimValue !== undefined && dimValue !== null ? String(dimValue) : "Unknown")
  );
};

/**
 * Human label for a dimension value, distinct from its plotted X value. For a
 * milestone the X value is its date, so the label carries the milestone NAME
 * for tooltips; returns undefined when there's nothing extra to show.
 */
const getDimensionLabel = (
  row: any,
  dimension: { value: string; label: string }
): string | undefined => {
  const dimValue = row[dimension.value];
  if (dimValue && typeof dimValue === "object" && dimValue.name) {
    return String(dimValue.name);
  }
  return undefined;
};

const getMetricValue = (
  row: any,
  metric: { value: string; label: string; originalLabel?: string }
): number => {
  // Try original English label first (for data access), then metric value, then translated label
  return Number(
    row[metric.originalLabel || metric.label] || row[metric.value] || 0
  );
};

// Helper type for issue color functions
type IssueColorFunctions = {
  getPriorityDotColor: (priority: string | null | undefined) => string;
  getStatusDotColor: (status: string | null | undefined) => string;
};

const getColor = (
  row: any,
  dimension: { value: string; label: string },
  issueColorFns?: IssueColorFunctions
): string | undefined => {
  const dimValueKey = dimension.value;
  if (dimValueKey === "status") {
    return row.status?.color || row.color;
  }
  if (
    dimValueKey === "user" ||
    dimValueKey === "creator" ||
    dimValueKey === "assignedTo"
  ) {
    const userName = getDimensionValue(row, dimension);
    return stringToColorCode(userName).colorCode;
  }
  if (dimValueKey === "state") {
    const stateValue = row[dimension.value];
    if (stateValue?.color) {
      return stateValue.color;
    }
    const itemName = getDimensionValue(row, dimension);
    return stringToColorCode(itemName).colorCode;
  }
  // Handle issue priority dimension
  if (dimValueKey === "priority" && issueColorFns) {
    const priorityValue = row[dimension.value];
    const priorityName = priorityValue?.name || priorityValue;
    return issueColorFns.getPriorityDotColor(priorityName);
  }
  // Handle issue status dimension
  if (dimValueKey === "issueStatus" && issueColorFns) {
    const statusValue = row[dimension.value];
    const statusName = statusValue?.name || statusValue;
    return issueColorFns.getStatusDotColor(statusName);
  }
  if (
    [
      "folder",
      "template",
      "source",
      "role",
      "session",
      "issueType",
      "configuration",
    ].includes(dimValueKey)
  ) {
    const itemName = getDimensionValue(row, dimension);
    return stringToColorCode(itemName).colorCode;
  }
  return row.color;
};

export const ReportChart: React.FC<ReportChartProps> = ({
  results,
  dimensions,
  metrics,
  reportType,
  projects,
  consecutiveRuns = 10,
  totalFlakyTests,
  projectId,
}) => {
  const locale = useLocale();
  const t = useTranslations();
  const { getPriorityDotColor, getStatusDotColor } = useIssueColors();

  // Early return if results is not a valid array
  if (!results || !Array.isArray(results)) {
    return null;
  }

  // Create issue color functions object to pass to getColor
  const issueColorFns: IssueColorFunctions = {
    getPriorityDotColor,
    getStatusDotColor,
  };

  // Filter out date metrics for chart rendering (they can still appear in the table)
  const chartMetrics = metrics.filter((metric) => {
    const label = metric.label.toLowerCase();
    return !(
      label.includes("date") ||
      metric.value === "lastActiveDate" ||
      metric.label === "Last Active Date"
    );
  });

  // Special handling for automation trends report
  if (
    reportType &&
    matchesReportType(reportType, "automation-trends") &&
    projects &&
    projects.length > 0
  ) {
    // Transform automation trends data into multi-line series
    const seriesMap = new Map<string, MultiLineSeries>();
    const isMultiProject = projects.length > 1;

    results.forEach((row) => {
      const date = new Date(row.periodStart);

      projects.forEach((project) => {
        const projectPrefix = project.name.replace(/\s+/g, "");

        // Create series for automated, manual, and total counts
        const automatedValue =
          (row[`${projectPrefix}_automated`] as number) || 0;
        const manualValue = (row[`${projectPrefix}_manual`] as number) || 0;
        const totalValue = (row[`${projectPrefix}_total`] as number) || 0;

        // For single-project reports, omit project name; for multi-project, include it
        const projectLabel = isMultiProject ? `${project.name} - ` : "";

        // Automated series
        const automatedSeriesName = `${projectLabel}Automated`;
        if (!seriesMap.has(automatedSeriesName)) {
          seriesMap.set(automatedSeriesName, {
            name: automatedSeriesName,
            values: [],
            color: "hsl(142, 76%, 36%)", // Green for automated
          });
        }
        seriesMap.get(automatedSeriesName)!.values.push({
          date,
          value: automatedValue,
          formattedValue: automatedValue.toString(),
        });

        // Manual series
        const manualSeriesName = `${projectLabel}Manual`;
        if (!seriesMap.has(manualSeriesName)) {
          seriesMap.set(manualSeriesName, {
            name: manualSeriesName,
            values: [],
            color: "hsl(221, 83%, 53%)", // Blue for manual
          });
        }
        seriesMap.get(manualSeriesName)!.values.push({
          date,
          value: manualValue,
          formattedValue: manualValue.toString(),
        });

        // Total series
        const totalSeriesName = `${projectLabel}Total`;
        if (!seriesMap.has(totalSeriesName)) {
          seriesMap.set(totalSeriesName, {
            name: totalSeriesName,
            values: [],
            color: "hsl(262, 83%, 58%)", // Purple for total
          });
        }
        seriesMap.get(totalSeriesName)!.values.push({
          date,
          value: totalValue,
          formattedValue: totalValue.toString(),
        });
      });
    });

    const transformedData = Array.from(seriesMap.values());
    return <ReportMultiLineChart data={transformedData} />;
  }

  // Special handling for execution log - status distribution donut
  // chartData here is statusBreakdown[] from allResults, not the paginated table rows
  if (reportType && matchesReportType(reportType, "execution-log")) {
    const donutData = results
      .filter((item: any) => item.count > 0)
      .map((item: any) => ({
        id: item.statusId ?? item.statusName,
        name: item.statusName ?? "Unknown",
        value: item.count,
        color: item.color ?? "#6b7280",
        formattedValue: String(item.count),
      }));
    if (donutData.length === 0) return null;
    const total = donutData.reduce((sum: number, d: any) => sum + d.value, 0);
    return (
      <RecentResultsDonut
        data={donutData}
        formattedTotal={total.toLocaleString(locale)}
      />
    );
  }

  // Special handling for flaky tests report - use bubble chart
  // Shows flip count vs recency of failures - tests in top-right need most attention
  if (reportType && matchesReportType(reportType, "flaky-tests")) {
    return (
      <FlakyTestsBubbleChart
        data={results}
        consecutiveRuns={consecutiveRuns}
        totalCount={totalFlakyTests}
        projectId={projectId}
      />
    );
  }

  // Special handling for test case health report - use combined donut + scatter chart
  // Shows health status distribution and health score vs days since execution
  if (reportType && matchesReportType(reportType, "test-case-health")) {
    return <TestCaseHealthChart data={results} projectId={projectId} />;
  }

  // Special handling for issue test coverage report - use stacked bar chart
  // Shows issues with their linked test cases and pass/fail/untested breakdown
  if (reportType && matchesReportType(reportType, "issue-test-coverage")) {
    return <IssueTestCoverageChart data={results} projectId={projectId} />;
  }

  const chartType = getChartType(dimensions, chartMetrics, results);

  if (
    results.length === 0 ||
    chartType === ChartType.None ||
    chartMetrics.length === 0
  ) {
    return null;
  }

  // Unit metadata wins; the id/label heuristics only classify metrics that
  // aren't in the units map (custom presets).
  const isElapsedTimeMetric = (metric: {
    value: string;
    label: string;
    originalLabel?: string;
  }): boolean => {
    const unit = metricUnit(metric.value);
    if (unit !== undefined) return unit === "seconds";
    const label = metric.label.toLowerCase();
    return (
      label.includes("elapsed") ||
      label.includes("time") ||
      label.includes("duration") ||
      metric.value === "averageResolutionTime" ||
      metric.label === "Average Resolution Time"
    );
  };

  const isPercentageMetric = (metric: {
    value: string;
    label: string;
    originalLabel?: string;
  }): boolean => {
    const unit = metricUnit(metric.value);
    if (unit !== undefined) return unit === "percent";
    const label = metric.label.toLowerCase();
    return (
      label.includes("rate") ||
      label.includes("percentage") ||
      label.includes("(%)") ||
      label.includes("%") ||
      metric.value === "completionRate" ||
      metric.label === "Completion Rate (%)"
    );
  };

  const formatMetricValue = (
    value: number,
    metric: { value: string; label: string; originalLabel?: string }
  ): string => {
    if (isElapsedTimeMetric(metric)) {
      // Display "-" for zero duration values
      if (value === 0) {
        return "-";
      }
      // Elapsed metrics return values in seconds
      return toHumanReadable(value, { isSeconds: true, locale });
    }
    if (isPercentageMetric(metric)) {
      if (value === null || value === undefined) return "—";
      return `${value.toFixed(2)}%`;
    }
    return value.toLocaleString(locale);
  };

  switch (chartType) {
    case ChartType.Donut:
    case ChartType.Bar:
    case ChartType.Line: {
      const dimension = dimensions[0];
      const metric = chartMetrics[0];
      const transformedData: SimpleChartDataPoint[] = results.map((row) => {
        const name = getDimensionValue(row, dimension);
        // Elapsed metrics are already in seconds — plot as-is.
        const value = getMetricValue(row, metric);
        const rawValue = value;
        const color = getColor(row, dimension, issueColorFns);
        const formattedValue = formatMetricValue(rawValue, metric);
        // Keep the milestone name for the tooltip when its date is on the X axis.
        const label = getDimensionLabel(row, dimension);

        return { id: name, name, value, color, formattedValue, label };
      });
      // A time-series line connects points in array order, so sort chronologically.
      // Line only happens for time dimensions (date, or milestone with dates), so
      // the chart-type check alone tells us the X axis is a date.
      if (chartType === ChartType.Line) {
        transformedData.sort(
          (a, b) => new Date(a.name).getTime() - new Date(b.name).getTime()
        );
      }

      if (chartType === ChartType.Donut) {
        let formattedTotal: string;

        if (isPercentageMetric(metric) || isElapsedTimeMetric(metric)) {
          // For percentages and elapsed time metrics, calculate the average instead of sum
          const averageValue =
            transformedData.reduce((sum, item) => sum + item.value, 0) /
            transformedData.length;
          formattedTotal = formatMetricValue(averageValue, metric);
        } else {
          // For non-percentages and non-elapsed time, sum as usual
          const totalValue = transformedData.reduce(
            (sum, item) => sum + item.value,
            0
          );
          formattedTotal = formatMetricValue(totalValue, metric);
        }

        const dataWithColors = transformedData.map((item) => ({
          ...item,
          color: item.color || stringToColorCode(item.name).colorCode,
        }));

        const centerLabel =
          isPercentageMetric(metric) || isElapsedTimeMetric(metric)
            ? t("charts.average")
            : undefined;

        return (
          <RecentResultsDonut
            data={dataWithColors}
            formattedTotal={formattedTotal}
            centerLabel={centerLabel}
          />
        );
      }
      if (chartType === ChartType.Bar) {
        return (
          <ReportBarChart
            data={transformedData}
            durationTicks={isElapsedTimeMetric(metric)}
          />
        );
      }
      if (chartType === ChartType.Line) {
        return (
          <ReportLineChart
            data={transformedData}
            durationTicks={isElapsedTimeMetric(metric)}
          />
        );
      }
      break;
    }
    case ChartType.Sunburst: {
      const metric = chartMetrics[0];

      const root: SunburstHierarchyNode = {
        name: "root",
        id: "root",
        children: [],
      };
      const hierarchyMap = new Map<string, SunburstHierarchyNode>();

      results.forEach((row) => {
        let currentLevelChildren = root.children!;
        let path = "";

        dimensions.forEach((dim, index) => {
          const dimValue = getDimensionValue(row, dim);
          path += `/${dimValue}`;

          let node = hierarchyMap.get(path);

          if (!node) {
            node = {
              name: dimValue,
              id: path,
              children: index === dimensions.length - 1 ? undefined : [],
              color:
                getColor(row, dim, issueColorFns) ||
                stringToColorCode(dimValue).colorCode,
            };
            hierarchyMap.set(path, node);
            currentLevelChildren.push(node);
          }

          if (index < dimensions.length - 1) {
            currentLevelChildren = node.children!;
          } else {
            // Leaf node — elapsed metrics are already in seconds
            const value = getMetricValue(row, metric);
            node.value = (node.value || 0) + value;
            node.formattedValue = formatMetricValue(node.value, metric);
          }
        });
      });

      // Calculate center total - use average for elapsed time metrics
      let centerTotal: number;
      let centerLabel: string;
      if (isElapsedTimeMetric(metric)) {
        centerTotal =
          results.reduce((sum, row) => sum + getMetricValue(row, metric), 0) /
          results.length;
        centerLabel = t("charts.average");
      } else {
        centerTotal = results.reduce(
          (sum, row) => sum + getMetricValue(row, metric),
          0
        );
        centerLabel = t("common.labels.total");
      }

      return (
        <ReportSunburstChart
          data={root}
          isTimeBased={isElapsedTimeMetric(metric)}
          totalValue={centerTotal}
          totalLabel={centerLabel}
        />
      );
    }
    case ChartType.GroupedBar: {
      const mainDimension = dimensions[0];
      const subDimension = dimensions[1];
      const metric = chartMetrics[0];

      const groupedData: GroupedChartDataPoint[] = results.map((row) => {
        const mainGroup = getDimensionValue(row, mainDimension);
        const subGroup = getDimensionValue(row, subDimension);
        // Elapsed metrics are already in seconds — plot as-is.
        const value = getMetricValue(row, metric);
        const color = getColor(row, subDimension, issueColorFns);
        return {
          mainGroup,
          subGroup,
          value,
          color,
          formattedValue: formatMetricValue(value, metric),
        };
      });
      return (
        <ReportGroupedBarChart
          data={groupedData}
          dimensions={dimensions}
          metrics={chartMetrics}
          durationTicks={isElapsedTimeMetric(metric)}
        />
      );
    }
    case ChartType.SmallMultiplesGroupedBar: {
      const firstDim = dimensions[0];
      const secondDim = dimensions[1];
      const selectedMetrics = chartMetrics.slice(0, 2); // Take first two metrics

      // Group by the first dimension
      const groupedByFirstDim = new Map<string, any[]>();
      results.forEach((row) => {
        const groupKey = getDimensionValue(row, firstDim);
        if (!groupedByFirstDim.has(groupKey)) {
          groupedByFirstDim.set(groupKey, []);
        }
        groupedByFirstDim.get(groupKey)!.push(row);
      });

      const transformedData: SmallMultipleData[] = Array.from(
        groupedByFirstDim.entries()
      ).map(([groupName, groupRows]) => {
        // Now process the inner group (second dimension)
        const innerGroupMap = new Map<string, any>();
        groupRows.forEach((row) => {
          const innerGroupName = getDimensionValue(row, secondDim);
          if (!innerGroupMap.has(innerGroupName)) {
            innerGroupMap.set(innerGroupName, { name: innerGroupName });
          }

          const entry = innerGroupMap.get(innerGroupName);
          selectedMetrics.forEach((metric) => {
            entry[metric.label] = getMetricValue(row, metric);
          });
        });

        return {
          groupName,
          data: Array.from(innerGroupMap.values()),
        };
      });

      return (
        <ReportSmallMultiplesGroupedBar
          data={transformedData}
          metrics={selectedMetrics}
          isElapsedTimeMetric={isElapsedTimeMetric}
        />
      );
    }
    case ChartType.MultiMetricBar: {
      const dimension = dimensions[0];
      const transformedData: MultiMetricDataPoint[] = [];

      results.forEach((row) => {
        const group = getDimensionValue(row, dimension);
        const color = getColor(row, dimension, issueColorFns);
        chartMetrics.forEach((metric) => {
          // Elapsed metrics are already in seconds — plot as-is.
          const value = getMetricValue(row, metric);
          const formattedValue = formatMetricValue(value, metric);

          transformedData.push({
            group,
            metricName: metric.label,
            value,
            formattedValue,
            color,
          });
        });
      });
      return <ReportMultiMetricBarChart data={transformedData} />;
    }
    case ChartType.MultiLine: {
      // The chronological axis is the date dimension, or a milestone plotted by
      // its own date; the remaining dimensions split into separate series.
      const dateDimension =
        dimensions.find((d) => d.value === "date") ??
        dimensions.find((d) => d.value === "milestone");
      if (!dateDimension) return null;
      const otherDimensions = dimensions.filter(
        (d) => d.value !== dateDimension.value
      );
      const isSingleMetric = chartMetrics.length === 1;

      const seriesMap = new Map<string, MultiLineSeries>();

      results.forEach((row) => {
        const date = new Date(getDimensionValue(row, dateDimension));

        if (isSingleMetric) {
          const metric = chartMetrics[0];
          // Group by other dimensions
          const seriesName = otherDimensions
            .map((dim) => getDimensionValue(row, dim))
            .join(" - ");
          // Elapsed metrics are already in seconds — plot as-is.
          const value = getMetricValue(row, metric);

          if (!seriesMap.has(seriesName)) {
            seriesMap.set(seriesName, { name: seriesName, values: [] });
          }
          seriesMap.get(seriesName)!.values.push({
            date,
            value,
            formattedValue: formatMetricValue(value, metric),
          });
        } else {
          // Group by metric name
          chartMetrics.forEach((metric) => {
            const seriesName = metric.label;
            // Elapsed metrics are already in seconds — plot as-is.
            const value = getMetricValue(row, metric);

            if (!seriesMap.has(seriesName)) {
              seriesMap.set(seriesName, { name: seriesName, values: [] });
            }
            seriesMap.get(seriesName)!.values.push({
              date,
              value,
              formattedValue: formatMetricValue(value, metric),
            });
          });
        }
      });

      const transformedData = Array.from(seriesMap.values());
      // Rows arrive in dimension order, not date order, so sort each series
      // chronologically to keep the connecting line from zig-zagging.
      transformedData.forEach((series) =>
        series.values.sort((a, b) => a.date.getTime() - b.date.getTime())
      );
      // The Y axis is shared across every plotted series, so duration ticks
      // only apply when all plotted metrics are elapsed-time.
      return (
        <ReportMultiLineChart
          data={transformedData}
          durationTicks={chartMetrics.every(isElapsedTimeMetric)}
        />
      );
    }
    default:
      return null;
  }
};
