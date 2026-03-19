import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Use vi.hoisted() for stable mock references to prevent infinite useEffect re-renders
const { mockStandardColumns, mockAutomationTrendsColumns, mockFlakyTestsColumns, mockTestCaseHealthColumns, mockIssueTestCoverageColumns } = vi.hoisted(() => {
  const col = (id: string) => ({ id, accessorKey: id, header: id, cell: ({ row }: any) => row.getValue(id) ?? "" });
  return {
    mockStandardColumns: [col("name"), col("value")],
    mockAutomationTrendsColumns: [col("date"), col("automated")],
    mockFlakyTestsColumns: [col("testName"), col("flipCount")],
    mockTestCaseHealthColumns: [col("testCase"), col("health")],
    mockIssueTestCoverageColumns: [col("issue"), col("coverage")],
  };
});

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

// Mock column hooks with stable refs
vi.mock("~/hooks/useReportColumns", () => ({
  useReportColumns: () => mockStandardColumns,
}));

vi.mock("~/hooks/useAutomationTrendsColumns", () => ({
  useAutomationTrendsColumns: () => mockAutomationTrendsColumns,
}));

vi.mock("~/hooks/useFlakyTestsColumns", () => ({
  useFlakyTestsColumns: () => mockFlakyTestsColumns,
}));

vi.mock("~/hooks/useTestCaseHealthColumns", () => ({
  useTestCaseHealthColumns: () => mockTestCaseHealthColumns,
}));

vi.mock("~/hooks/useIssueTestCoverageColumns", () => ({
  useIssueTestCoverageSummaryColumns: () => mockIssueTestCoverageColumns,
}));

// Mock DataTable to render data rows for inspection
vi.mock("~/components/tables/DataTable", () => ({
  DataTable: ({ data, columns }: { data: any[]; columns: any[] }) => (
    <div data-testid="data-table">
      {data.map((row, i) => (
        <div key={i} data-testid="data-table-row">
          {columns.map((col: any) => (
            <span key={col.id || col.accessorKey}>{row[col.accessorKey] ?? ""}</span>
          ))}
        </div>
      ))}
    </div>
  ),
}));

// Mock ReportChart to avoid D3 complexity
vi.mock("@/components/dataVisualizations/ReportChart", () => ({
  ReportChart: ({ results }: { results: any[] }) => (
    <div data-testid="report-chart">chart-data-length:{results.length}</div>
  ),
}));

// Mock PaginationComponent
vi.mock("~/components/tables/Pagination", () => ({
  PaginationComponent: () => <div data-testid="pagination" />,
}));

// Mock PaginationControls
vi.mock("~/components/tables/PaginationControls", () => ({
  PaginationInfo: () => <div data-testid="pagination-info" />,
}));

// Mock DateFormatter
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: any }) => <span>{String(date)}</span>,
}));

// Mock ResizablePanelGroup components to render children directly
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

// Mock PaginationContext
vi.mock("~/lib/contexts/PaginationContext", () => ({
  defaultPageSizeOptions: [10, 25, 50, 100, "All"],
}));

import { ReportRenderer } from "./ReportRenderer";

const defaultProps = {
  results: [],
  reportType: "repository-stats",
  currentPage: 1,
  pageSize: 10 as number | "All",
  totalCount: 0,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  onSortChange: vi.fn(),
  columnVisibility: {},
  onColumnVisibilityChange: vi.fn(),
};

const sampleResults = [
  { name: "Test A", value: "10" },
  { name: "Test B", value: "20" },
];

describe("ReportRenderer", () => {
  it("renders empty state when results is empty array", () => {
    render(<ReportRenderer {...defaultProps} results={[]} />);
    expect(screen.getByText("noResultsFound")).toBeInTheDocument();
  });

  it("renders 'select dimension and metric' message when no dimensions or metrics", () => {
    render(<ReportRenderer {...defaultProps} results={[]} dimensions={[]} metrics={[]} />);
    expect(screen.getByText("selectAtLeastOneDimensionAndMetric")).toBeInTheDocument();
  });

  it("renders 'no data matching criteria' when dimensions and metrics provided but no results", () => {
    render(
      <ReportRenderer
        {...defaultProps}
        results={[]}
        dimensions={[{ value: "user", label: "User" }]}
        metrics={[{ value: "count", label: "Count" }]}
      />
    );
    expect(screen.getByText("noDataMatchingCriteria")).toBeInTheDocument();
  });

  it("renders results table when results array is non-empty", () => {
    render(
      <ReportRenderer
        {...defaultProps}
        results={sampleResults}
        totalCount={2}
        reportType="repository-stats"
      />
    );
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
    expect(screen.getAllByTestId("data-table-row")).toHaveLength(2);
  });

  it("renders chart visualization section when chartData is provided with dimensions and metrics", () => {
    render(
      <ReportRenderer
        {...defaultProps}
        results={sampleResults}
        chartData={sampleResults}
        reportType="repository-stats"
        dimensions={[{ value: "user", label: "User" }]}
        metrics={[{ value: "count", label: "Count" }]}
        totalCount={2}
      />
    );
    expect(screen.getByTestId("report-chart")).toBeInTheDocument();
  });

  it("renders with preGeneratedColumns when provided", () => {
    const preGeneratedColumns = [
      { id: "custom1", accessorKey: "custom1", header: "Custom 1", cell: () => "" },
    ];
    render(
      <ReportRenderer
        {...defaultProps}
        results={sampleResults}
        reportType="repository-stats"
        preGeneratedColumns={preGeneratedColumns}
        totalCount={2}
      />
    );
    // DataTable rendered, preGenerated cols used (no error)
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
  });

  it("renders automation-trends report type using automation trends columns", () => {
    const trendResults = [
      { date: "2024-01-01", automated: "5" },
      { date: "2024-01-08", automated: "10" },
    ];
    render(
      <ReportRenderer
        {...defaultProps}
        results={trendResults}
        reportType="automation-trends"
        totalCount={2}
      />
    );
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
    // Automation trends renders chart by default (isAutomationTrends = true)
    expect(screen.getByTestId("report-chart")).toBeInTheDocument();
  });

  it("renders reportSummary and reportGeneratedAt when provided", () => {
    render(
      <ReportRenderer
        {...defaultProps}
        results={sampleResults}
        reportType="repository-stats"
        totalCount={2}
        reportSummary="Summary text"
        reportGeneratedAt={new Date("2024-01-01")}
      />
    );
    expect(screen.getByText("Summary text")).toBeInTheDocument();
  });
});
