import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseFindFirst } = vi.hoisted(() => ({
  mockUseFindFirst: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    shareLink: { useFindFirst: mockUseFindFirst },
  }),
}));

vi.mock("@/actions/share-links", () => ({
  auditShareLinkCreation: vi.fn(),
  prepareShareLinkData: vi.fn(),
}));

import { SavedReportContext } from "./SavedReportContext";

describe("SavedReportContext", () => {
  beforeEach(() => {
    mockUseFindFirst.mockReset();
  });

  it("renders the saved report's title and description", () => {
    mockUseFindFirst.mockReturnValue({
      data: { title: "Weekly pass rate", description: "For the Monday sync" },
    });

    render(<SavedReportContext savedReportId="report-1" />);

    const context = screen.getByTestId("saved-report-context");
    expect(context).toHaveTextContent("Weekly pass rate");
    expect(screen.getByText("For the Monday sync")).toBeInTheDocument();
  });

  it("renders nothing while there is no saved report", () => {
    mockUseFindFirst.mockReturnValue({ data: undefined });

    const { container } = render(
      <SavedReportContext savedReportId="report-1" />
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId("saved-report-context")
    ).not.toBeInTheDocument();
  });

  it("omits the description line when the description is null", () => {
    mockUseFindFirst.mockReturnValue({
      data: { title: "Weekly pass rate", description: null },
    });

    render(<SavedReportContext savedReportId="report-1" />);

    const context = screen.getByTestId("saved-report-context");
    expect(context.querySelectorAll("p")).toHaveLength(1);
    expect(context).toHaveTextContent("Weekly pass rate");
  });

  it("queries only the live SAVED_REPORT row with this id", () => {
    mockUseFindFirst.mockReturnValue({ data: undefined });

    render(<SavedReportContext savedReportId="report-42" />);

    expect(mockUseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "report-42",
          entityType: "SAVED_REPORT",
          isDeleted: false,
        },
      })
    );
  });
});
