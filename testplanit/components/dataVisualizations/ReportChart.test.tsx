import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportChart } from "./ReportChart";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

// Mock useIssueColors
vi.mock("~/hooks/useIssueColors", () => ({
  useIssueColors: () => ({
    getPriorityDotColor: (_priority: string | null | undefined) => "#ff0000",
    getStatusDotColor: (_status: string | null | undefined) => "#00ff00",
  }),
}));

// Mock duration utility
vi.mock("~/utils/duration", () => ({
  toHumanReadable: (_ms: number) => "1m",
}));

// Mock stringToColorCode utility
vi.mock("~/utils/stringToColorCode", () => ({
  stringToColorCode: (_str: string) => ({ colorCode: "#aabbcc" }),
}));

// Mock all sub-chart components - each renders a div with a data-testid
vi.mock("./ReportBarChart", () => ({
  ReportBarChart: () => <div data-testid="ReportBarChart" />,
}));

vi.mock("./ReportLineChart", () => ({
  ReportLineChart: () => <div data-testid="ReportLineChart" />,
}));

vi.mock("./ReportGroupedBarChart", () => ({
  ReportGroupedBarChart: () => <div data-testid="ReportGroupedBarChart" />,
}));

vi.mock("./ReportSunburstChart", () => ({
  ReportSunburstChart: () => <div data-testid="ReportSunburstChart" />,
}));

vi.mock("./ReportMultiLineChart", () => ({
  ReportMultiLineChart: () => <div data-testid="ReportMultiLineChart" />,
}));

vi.mock("./ReportMultiMetricBarChart", () => ({
  ReportMultiMetricBarChart: () => <div data-testid="ReportMultiMetricBarChart" />,
}));

vi.mock("./ReportSmallMultiplesGroupedBar", () => ({
  ReportSmallMultiplesGroupedBar: () => <div data-testid="ReportSmallMultiplesGroupedBar" />,
}));

vi.mock("./FlakyTestsBubbleChart", () => ({
  FlakyTestsBubbleChart: () => <div data-testid="FlakyTestsBubbleChart" />,
}));

vi.mock("./IssueTestCoverageChart", () => ({
  IssueTestCoverageChart: () => <div data-testid="IssueTestCoverageChart" />,
}));

vi.mock("./TestCaseHealthChart", () => ({
  TestCaseHealthChart: () => <div data-testid="TestCaseHealthChart" />,
}));

vi.mock("./RecentResultsDonut", () => ({
  default: () => <div data-testid="RecentResultsDonut" />,
}));

describe("ReportChart", () => {
  // A result row for bar chart: use a non-categorical, non-date dimension (e.g. "testCaseId")
  // The getChartType logic: 1 dim, 1 metric, dim NOT in categoricalDims and NOT "date" -> Bar
  const mockBarResults = [
    { testCaseId: "TC-001", count: 30 },
    { testCaseId: "TC-002", count: 70 },
  ];

  // Results for a date-dimension single-metric query -> Line chart
  const mockLineResults = [
    { date: { executedAt: "2024-01-01" }, count: 10 },
    { date: { executedAt: "2024-02-01" }, count: 25 },
  ];

  // Results for sunburst: 2 dims where NOT all are in categoricalDims
  // "folder" IS categorical, "testCaseId" is NOT -> not all categorical -> Sunburst
  const mockSunburstResults = [
    { folder: { name: "Folder A" }, testCaseId: "TC-001", count: 5 },
    { folder: { name: "Folder B" }, testCaseId: "TC-002", count: 3 },
  ];

  // "testCaseId" is not in the categorical list -> Bar (not Donut)
  const barDimensions = [{ value: "testCaseId", label: "Test Case ID" }];
  const barMetrics = [{ value: "count", label: "Count" }];

  const lineDimensions = [{ value: "date", label: "Date" }];
  const lineMetrics = [{ value: "count", label: "Count" }];

  // 2 dims where NOT all are categorical -> Sunburst
  const sunburstDimensions = [
    { value: "folder", label: "Folder" },
    { value: "testCaseId", label: "Test Case ID" },
  ];
  const sunburstMetrics = [{ value: "count", label: "Count" }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders ReportBarChart when dimension is non-categorical, non-date with 1 metric", () => {
    render(
      <ReportChart
        results={mockBarResults}
        dimensions={barDimensions}
        metrics={barMetrics}
      />
    );
    expect(screen.getByTestId("ReportBarChart")).toBeInTheDocument();
  });

  it("renders ReportLineChart when dimension is date with 1 metric", () => {
    render(
      <ReportChart
        results={mockLineResults}
        dimensions={lineDimensions}
        metrics={lineMetrics}
      />
    );
    expect(screen.getByTestId("ReportLineChart")).toBeInTheDocument();
  });

  it("renders ReportSunburstChart when 2 non-categorical dimensions with 1 metric", () => {
    render(
      <ReportChart
        results={mockSunburstResults}
        dimensions={sunburstDimensions}
        metrics={sunburstMetrics}
      />
    );
    expect(screen.getByTestId("ReportSunburstChart")).toBeInTheDocument();
  });

  it("renders FlakyTestsBubbleChart when reportType is 'flaky-tests'", () => {
    render(
      <ReportChart
        results={[{ testCaseId: 1, testCaseName: "Test A", flipCount: 3, executions: [] }]}
        dimensions={[]}
        metrics={[]}
        reportType="flaky-tests"
        consecutiveRuns={10}
      />
    );
    expect(screen.getByTestId("FlakyTestsBubbleChart")).toBeInTheDocument();
  });

  it("renders FlakyTestsBubbleChart for cross-project flaky-tests variant", () => {
    render(
      <ReportChart
        results={[{ testCaseId: 1, testCaseName: "Test A", flipCount: 3, executions: [] }]}
        dimensions={[]}
        metrics={[]}
        reportType="cross-project-flaky-tests"
        consecutiveRuns={10}
      />
    );
    expect(screen.getByTestId("FlakyTestsBubbleChart")).toBeInTheDocument();
  });

  it("renders TestCaseHealthChart when reportType is 'test-case-health'", () => {
    render(
      <ReportChart
        results={[{ testCaseId: 1, testCaseName: "Test A", healthStatus: "healthy", healthScore: 80, isStale: false }]}
        dimensions={[]}
        metrics={[]}
        reportType="test-case-health"
      />
    );
    expect(screen.getByTestId("TestCaseHealthChart")).toBeInTheDocument();
  });

  it("renders IssueTestCoverageChart when reportType is 'issue-test-coverage'", () => {
    render(
      <ReportChart
        results={[{ issueId: 1, title: "Issue A" }]}
        dimensions={[]}
        metrics={[]}
        reportType="issue-test-coverage"
      />
    );
    expect(screen.getByTestId("IssueTestCoverageChart")).toBeInTheDocument();
  });

  it("renders nothing when results is empty array and no special reportType", () => {
    const { container } = render(
      <ReportChart
        results={[]}
        dimensions={barDimensions}
        metrics={barMetrics}
      />
    );
    // Empty results returns null for non-special report types
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when results is null/undefined", () => {
    const { container } = render(
      <ReportChart
        results={null as any}
        dimensions={barDimensions}
        metrics={barMetrics}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when dimensions is empty and no special reportType", () => {
    const { container } = render(
      <ReportChart
        results={mockBarResults}
        dimensions={[]}
        metrics={barMetrics}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when metrics is empty and no special reportType", () => {
    const { container } = render(
      <ReportChart
        results={mockBarResults}
        dimensions={barDimensions}
        metrics={[]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders RecentResultsDonut when dimension is categorical (status) with 1 metric", () => {
    const statusResults = [
      { status: { name: "Passed", color: "#22c55e" }, count: 45 },
      { status: { name: "Failed", color: "#ef4444" }, count: 10 },
    ];
    render(
      <ReportChart
        results={statusResults}
        dimensions={[{ value: "status", label: "Status" }]}
        metrics={[{ value: "count", label: "Count" }]}
      />
    );
    expect(screen.getByTestId("RecentResultsDonut")).toBeInTheDocument();
  });

  it("renders ReportMultiLineChart for automation-trends report type", () => {
    const automationResults = [
      { periodStart: "2024-01-01", TestProject_automated: 10, TestProject_manual: 5, TestProject_total: 15 },
    ];
    render(
      <ReportChart
        results={automationResults}
        dimensions={[]}
        metrics={[]}
        reportType="automation-trends"
        projects={[{ id: 1, name: "Test Project" }]}
      />
    );
    expect(screen.getByTestId("ReportMultiLineChart")).toBeInTheDocument();
  });

  it("renders nothing when date metric is present (date metrics not visualized)", () => {
    const { container } = render(
      <ReportChart
        results={mockBarResults}
        dimensions={barDimensions}
        metrics={[{ value: "lastActiveDate", label: "Last Active Date" }]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders ReportGroupedBarChart when 2 categorical dimensions with 1 metric", () => {
    const groupedResults = [
      { status: { name: "Passed" }, user: { name: "Alice" }, count: 10 },
      { status: { name: "Failed" }, user: { name: "Bob" }, count: 5 },
    ];
    render(
      <ReportChart
        results={groupedResults}
        dimensions={[
          { value: "status", label: "Status" },
          { value: "user", label: "User" },
        ]}
        metrics={[{ value: "count", label: "Count" }]}
      />
    );
    expect(screen.getByTestId("ReportGroupedBarChart")).toBeInTheDocument();
  });
});
