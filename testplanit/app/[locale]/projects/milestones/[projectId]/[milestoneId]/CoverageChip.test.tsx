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
        }}
      />
    );
    const badge = screen.getByText("coverageUncovered");
    expect(badge).toBeInTheDocument();
    // Distinct outlined/amber style, not a result color (D-05).
    expect(badge.className).toMatch(/amber/);
  });

  it("renders an Uncovered chip when breakdown is undefined", () => {
    render(<CoverageChip breakdown={undefined} />);
    expect(screen.getByText("coverageUncovered")).toBeInTheDocument();
  });

  it("renders passed/failed/inProgress/notRun segments when covered", () => {
    render(
      <CoverageChip
        breakdown={{
          linkedCaseCount: 4,
          passed: 2,
          failed: 1,
          inProgress: 1,
          notRun: 0,
          uncovered: false,
        }}
      />
    );
    // Matrix-style pips: passed 2, failed 1, untested 1 (inProgress folds
    // into Untested — no completed outcome yet); tooltip keeps the full
    // four-way breakdown.
    expect(screen.getByLabelText("coveragePassed: 2")).toBeInTheDocument();
    expect(screen.getByLabelText("coverageFailed: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("coverageUntested: 1")).toBeInTheDocument();
    expect(screen.getByTestId("coverage-pips")).toHaveAttribute(
      "title",
      expect.stringContaining("coverageInProgress: 1")
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
        }}
      />
    );
    expect(screen.queryByText("coverageUncovered")).not.toBeInTheDocument();
    expect(screen.getByLabelText("coverageUntested: 2")).toBeInTheDocument();
  });
});
