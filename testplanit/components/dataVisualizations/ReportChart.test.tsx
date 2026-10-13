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
  ReportLineChart: ({ data }: { data?: Array<{ value: number }> }) => (
    <div
      data-testid="ReportLineChart"
      data-values={JSON.stringify(data?.map((d) => d.value))}
    />
  ),
}));

vi.mock("./ReportGroupedBarChart", () => ({
  ReportGroupedBarChart: () => <div data-testid="ReportGroupedBarChart" />,
}));

vi.mock("./ReportSunburstChart", () => ({
  ReportSunburstChart: () => <div data-testid="ReportSunburstChart" />,
}));

vi.mock("./ReportMultiLineChart", () => ({
  ReportMultiLineChart: ({
    data,
  }: {
    data?: Array<{
      name: string;
      emphasis?: boolean;
      values: Array<{ value: number }>;
    }>;
  }) => (
    <div
      data-testid="ReportMultiLineChart"
      data-series={JSON.stringify(
        data?.map((s) => ({
          name: s.name,
          emphasis: s.emphasis ?? false,
          values: s.values.map((v) => v.value),
        }))
      )}
    />
  ),
}));

vi.mock("./ReportMultiMetricBarChart", () => ({
  ReportMultiMetricBarChart: () => (
    <div data-testid="ReportMultiMetricBarChart" />
  ),
}));

vi.mock("./ReportSmallMultiplesGroupedBar", () => ({
  ReportSmallMultiplesGroupedBar: () => (
    <div data-testid="ReportSmallMultiplesGroupedBar" />
  ),
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
        results={[
          {
            testCaseId: 1,
            testCaseName: "Test A",
            flipCount: 3,
            executions: [],
          },
        ]}
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
        results={[
          {
            testCaseId: 1,
            testCaseName: "Test A",
            flipCount: 3,
            executions: [],
          },
        ]}
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
        results={[
          {
            testCaseId: 1,
            testCaseName: "Test A",
            healthStatus: "healthy",
            healthScore: 80,
            isStale: false,
          },
        ]}
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
      {
        periodStart: "2024-01-01",
        TestProject_automated: 10,
        TestProject_manual: 5,
        TestProject_total: 15,
      },
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

  const multiLineDimensions = [
    { value: "date", label: "Date" },
    { value: "testCase", label: "Test Case" },
  ];
  const multiLineResults = [
    {
      date: { executedAt: "2026-07-02T00:00:00.000Z" },
      testCase: { id: 1, name: "Login" },
      "Avg. Elapsed Time": 12,
    },
    {
      date: { executedAt: "2026-07-01T00:00:00.000Z" },
      testCase: { id: 1, name: "Login" },
      "Avg. Elapsed Time": 10,
    },
    {
      date: { executedAt: "2026-07-01T00:00:00.000Z" },
      testCase: { id: 2, name: "Checkout" },
      "Avg. Elapsed Time": 30,
    },
  ];
  const readSeries = () =>
    JSON.parse(
      screen.getByTestId("ReportMultiLineChart").getAttribute("data-series")!
    ) as Array<{ name: string; emphasis: boolean; values: number[] }>;

  it("appends an emphasized total series summing the plotted series per date", () => {
    render(
      <ReportChart
        results={multiLineResults}
        showTotals
        dimensions={multiLineDimensions}
        metrics={[{ value: "avgElapsedTime", label: "Avg. Elapsed Time" }]}
      />
    );
    const series = readSeries();
    expect(series.map((s) => s.name)).toEqual([
      "Login",
      "Checkout",
      "common.labels.total",
    ]);
    const total = series[2];
    expect(total.emphasis).toBe(true);
    // Sorted chronologically: 07-01 = 10 + 30, 07-02 = 12 (Checkout has no
    // value that day and contributes nothing).
    expect(total.values).toEqual([40, 12]);
    expect(series[0].emphasis).toBe(false);
  });

  it("plots no total series when the option is off", () => {
    render(
      <ReportChart
        results={multiLineResults}
        dimensions={multiLineDimensions}
        metrics={[{ value: "avgElapsedTime", label: "Avg. Elapsed Time" }]}
      />
    );
    expect(readSeries().map((s) => s.name)).toEqual(["Login", "Checkout"]);
  });

  it("plots no total series for a percentage metric", () => {
    render(
      <ReportChart
        results={multiLineResults.map((row) => ({
          date: row.date,
          testCase: row.testCase,
          "Pass Rate (%)": 50,
        }))}
        showTotals
        dimensions={multiLineDimensions}
        metrics={[{ value: "passRate", label: "Pass Rate (%)" }]}
      />
    );
    expect(readSeries().map((s) => s.name)).toEqual(["Login", "Checkout"]);
  });

  it("sums the plotted series per milestone when milestones form the time axis", () => {
    const m1 = { id: 1, name: "Sprint 1", date: "2026-06-01T00:00:00.000Z" };
    const m2 = { id: 2, name: "Sprint 2", date: "2026-06-15T00:00:00.000Z" };
    render(
      <ReportChart
        results={[
          {
            milestone: m2,
            status: { name: "Passed" },
            "Test Results Count": 5,
          },
          {
            milestone: m1,
            status: { name: "Passed" },
            "Test Results Count": 8,
          },
          {
            milestone: m1,
            status: { name: "Failed" },
            "Test Results Count": 2,
          },
        ]}
        showTotals
        dimensions={[
          { value: "milestone", label: "Milestone" },
          { value: "status", label: "Status" },
        ]}
        metrics={[{ value: "testResults", label: "Test Results Count" }]}
      />
    );
    const series = readSeries();
    expect(series.map((s) => s.name)).toEqual([
      "Passed",
      "Failed",
      "common.labels.total",
    ]);
    expect(series[2].values).toEqual([10, 5]);
  });

  it("plots no total series when there is only one series to sum", () => {
    render(
      <ReportChart
        results={multiLineResults.slice(0, 2)}
        showTotals
        dimensions={multiLineDimensions}
        metrics={[{ value: "avgElapsedTime", label: "Avg. Elapsed Time" }]}
      />
    );
    expect(readSeries().map((s) => s.name)).toEqual(["Login"]);
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

  it("resolves metric values through apiLabel when the display label differs from the data key", () => {
    // Report API rows are keyed by the registry's English label ("Test Results
    // Count") while ReportBuilder displays the translated label ("Test
    // Results") — the chart must read data through apiLabel.
    const results = [
      { date: { executedAt: "2024-01-01" }, "Test Results Count": 4 },
      { date: { executedAt: "2024-02-01" }, "Test Results Count": 7 },
    ];
    render(
      <ReportChart
        results={results}
        dimensions={[{ value: "date", label: "Date" }]}
        metrics={[
          {
            value: "testResults",
            label: "Test Results",
            apiLabel: "Test Results Count",
          },
        ]}
      />
    );
    expect(screen.getByTestId("ReportLineChart")).toHaveAttribute(
      "data-values",
      JSON.stringify([4, 7])
    );
  });

  it("falls back to the display label as data key when apiLabel is absent (shared-report metrics)", () => {
    const results = [
      { date: { executedAt: "2024-01-01" }, "Test Results Count": 3 },
      { date: { executedAt: "2024-02-01" }, "Test Results Count": 9 },
    ];
    render(
      <ReportChart
        results={results}
        dimensions={[{ value: "date", label: "Execution Date" }]}
        metrics={[{ value: "testResults", label: "Test Results Count" }]}
      />
    );
    expect(screen.getByTestId("ReportLineChart")).toHaveAttribute(
      "data-values",
      JSON.stringify([3, 9])
    );
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
