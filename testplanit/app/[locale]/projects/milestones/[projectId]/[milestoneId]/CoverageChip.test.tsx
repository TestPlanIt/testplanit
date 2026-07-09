import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { CoverageChip } from "./CoverageChip";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("CoverageChip", () => {
  it("renders a distinct Uncovered chip when breakdown.uncovered is true", () => {
    render(
      <CoverageChip
        breakdown={{
          linkedCaseCount: 0,
          passed: 0,
          failed: 0,
          inProgress: 0,
          notRun: 0,
          uncovered: true,
          statuses: [],
          untested: 0,
        }}
      />
    );
    const badge = screen.getByText("coverageUncovered");
    expect(badge).toBeInTheDocument();
    // Distinct warning-token style, not a result color (D-05) — tokens
    // adapt per theme where hardcoded ambers did not.
    expect(badge.className).toMatch(/border-warning/);
    expect(badge.className).toMatch(/border-dashed/);
  });

  it("renders an Uncovered chip when breakdown is undefined", () => {
    render(<CoverageChip breakdown={undefined} />);
    expect(screen.getByText("coverageUncovered")).toBeInTheDocument();
  });

  it("renders one pip per actual status among latest results, plus Untested", () => {
    render(
      <CoverageChip
        breakdown={{
          linkedCaseCount: 4,
          passed: 2,
          failed: 1,
          inProgress: 1,
          notRun: 0,
          uncovered: false,
          statuses: [
            { statusId: 1, name: "Passed", color: "#22c55e", count: 2 },
            { statusId: 2, name: "Failed", color: "#ef4444", count: 1 },
            { statusId: 5, name: "In Automation", color: "#3b82f6", count: 1 },
          ],
          untested: 0,
        }}
      />
    );
    // Matrix display model: real project statuses, not buckets.
    expect(screen.getByLabelText("Passed: 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Failed: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("In Automation: 1")).toBeInTheDocument();
    // All 4 linked cases have latest results — no Untested pip.
    expect(screen.queryByLabelText(/labels.untested/)).not.toBeInTheDocument();
    expect(screen.getByTestId("coverage-pips")).toHaveAttribute(
      "title",
      expect.stringContaining("In Automation: 1")
    );
  });

  it("does not render the Uncovered style for a covered-but-all-notRun breakdown", () => {
    render(
      <CoverageChip
        breakdown={{
          linkedCaseCount: 2,
          passed: 0,
          failed: 0,
          inProgress: 0,
          notRun: 2,
          uncovered: false,
          statuses: [],
          untested: 2,
        }}
      />
    );
    expect(screen.queryByText("coverageUncovered")).not.toBeInTheDocument();
    expect(screen.getByLabelText("labels.untested: 2")).toBeInTheDocument();
  });
});
