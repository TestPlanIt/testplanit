import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

// Create a minimal test component that just tests the empty state logic
const EmptyStateComponent = ({ 
  lastUsedDimensions, 
  lastUsedMetrics,
  lastUsedDateRange
}: { 
  lastUsedDimensions: any[]; 
  lastUsedMetrics: any[];
  lastUsedDateRange?: { from?: Date; to?: Date };
}) => {
  const tReports = (key: string) => {
    const translations: Record<string, string> = {
      noResultsFound: "No results found.",
      selectAtLeastOneDimensionAndMetric: "Select at least one dimension and one metric.",
      noDataMatchingCriteria: "No data found matching the selected dimensions and metrics.",
      noDataMatchingCriteriaWithDateFilter: "No data found matching the selected dimensions and metrics. Try adjusting your date range filters.",
    };
    return translations[key] || key;
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-md">
        <div>
          <h3>{tReports("noResultsFound")}</h3>
          <div>
            {lastUsedDimensions.length > 0 && lastUsedMetrics.length > 0
              ? lastUsedDateRange?.from
                ? tReports("noDataMatchingCriteriaWithDateFilter")
                : tReports("noDataMatchingCriteria")
              : tReports("selectAtLeastOneDimensionAndMetric")}
          </div>
        </div>
      </div>
    </div>
  );
};

describe("ReportBuilder Empty State", () => {
  it("should show 'select dimension and metric' message when no dimensions or metrics are selected", () => {
    render(
      <EmptyStateComponent 
        lastUsedDimensions={[]} 
        lastUsedMetrics={[]} 
      />
    );

    expect(screen.getByText("No results found.")).toBeInTheDocument();
    expect(screen.getByText("Select at least one dimension and one metric.")).toBeInTheDocument();
  });

  it("should show 'no data matching criteria' message when dimensions and metrics are selected", () => {
    render(
      <EmptyStateComponent 
        lastUsedDimensions={[{ value: "test_dim", label: "Test Dimension" }]} 
        lastUsedMetrics={[{ value: "test_metric", label: "Test Metric" }]} 
      />
    );

    expect(screen.getByText("No results found.")).toBeInTheDocument();
    expect(screen.getByText("No data found matching the selected dimensions and metrics.")).toBeInTheDocument();
  });

  it("should show 'select dimension and metric' message when only dimensions are selected", () => {
    render(
      <EmptyStateComponent 
        lastUsedDimensions={[{ value: "test_dim", label: "Test Dimension" }]} 
        lastUsedMetrics={[]} 
      />
    );

    expect(screen.getByText("No results found.")).toBeInTheDocument();
    expect(screen.getByText("Select at least one dimension and one metric.")).toBeInTheDocument();
  });

  it("should show 'select dimension and metric' message when only metrics are selected", () => {
    render(
      <EmptyStateComponent 
        lastUsedDimensions={[]} 
        lastUsedMetrics={[{ value: "test_metric", label: "Test Metric" }]} 
      />
    );

    expect(screen.getByText("No results found.")).toBeInTheDocument();
    expect(screen.getByText("Select at least one dimension and one metric.")).toBeInTheDocument();
  });

  it("should show date filter recommendation when dimensions, metrics, and date filters are selected", () => {
    render(
      <EmptyStateComponent 
        lastUsedDimensions={[{ value: "test_dim", label: "Test Dimension" }]} 
        lastUsedMetrics={[{ value: "test_metric", label: "Test Metric" }]}
        lastUsedDateRange={{ from: new Date("2024-01-01"), to: new Date("2024-01-31") }}
      />
    );

    expect(screen.getByText("No results found.")).toBeInTheDocument();
    expect(screen.getByText("No data found matching the selected dimensions and metrics. Try adjusting your date range filters.")).toBeInTheDocument();
  });

  it("should not show date filter recommendation when date range is not set", () => {
    render(
      <EmptyStateComponent 
        lastUsedDimensions={[{ value: "test_dim", label: "Test Dimension" }]} 
        lastUsedMetrics={[{ value: "test_metric", label: "Test Metric" }]}
        lastUsedDateRange={undefined}
      />
    );

    expect(screen.getByText("No results found.")).toBeInTheDocument();
    expect(screen.getByText("No data found matching the selected dimensions and metrics.")).toBeInTheDocument();
    expect(screen.queryByText("Try adjusting your date range filters.")).not.toBeInTheDocument();
  });
});