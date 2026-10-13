// The traceability report's visualization panel: per-REQUIREMENT stat
// tiles computed from the same pair-level rows the table renders. The
// dedupe by requirementId is the seam under test — a requirement with
// many covering cases is many rows but ONE requirement here.

import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

import { RequirementCoverageSummaryTiles } from "./RequirementCoverageSummaryTiles";

function rowsFor(
  entries: Array<[number, string]>
): Array<{ requirementId: number; coverageStatus: string }> {
  return entries.map(([requirementId, coverageStatus]) => ({
    requirementId,
    coverageStatus,
  }));
}

describe("RequirementCoverageSummaryTiles", () => {
  it("counts each requirement once, not once per covering-case row", () => {
    render(
      <RequirementCoverageSummaryTiles
        rows={rowsFor([
          // Requirement 1: three covering-case rows, all PASSED.
          [1, "PASSED"],
          [1, "PASSED"],
          [1, "PASSED"],
          [2, "FAILED"],
          [3, "NOT_RUN"],
          [4, "UNCOVERED"],
          [5, "UNCOVERED"],
        ])}
      />
    );

    expect(screen.getByTestId("requirement-summary-total")).toHaveTextContent(
      "5"
    );
    expect(screen.getByTestId("requirement-summary-passed")).toHaveTextContent(
      "1"
    );
    expect(screen.getByTestId("requirement-summary-failed")).toHaveTextContent(
      "1"
    );
    expect(screen.getByTestId("requirement-summary-not_run")).toHaveTextContent(
      "1"
    );
    expect(
      screen.getByTestId("requirement-summary-uncovered")
    ).toHaveTextContent("2");
  });

  it("derives covered count and percent from the non-uncovered requirements", () => {
    render(
      <RequirementCoverageSummaryTiles
        rows={rowsFor([
          [1, "PASSED"],
          [2, "FAILED"],
          [3, "NOT_RUN"],
          [4, "UNCOVERED"],
        ])}
      />
    );

    const covered = screen.getByTestId("requirement-summary-covered");
    expect(covered).toHaveTextContent("3");
    expect(covered).toHaveTextContent("75%");
  });

  it("renders nothing for an empty result set", () => {
    const { container } = render(<RequirementCoverageSummaryTiles rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels every state tile with the tree's own vocabulary keys", () => {
    render(<RequirementCoverageSummaryTiles rows={rowsFor([[1, "PASSED"]])} />);

    expect(screen.getByText("statusPassed")).toBeInTheDocument();
    expect(screen.getByText("statusFailed")).toBeInTheDocument();
    expect(screen.getByText("statusNotRun")).toBeInTheDocument();
    expect(screen.getByText("uncovered")).toBeInTheDocument();
  });
});
