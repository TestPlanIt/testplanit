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
    expect(screen.getByText("coveragePassed: 2")).toBeInTheDocument();
    expect(screen.getByText("coverageFailed: 1")).toBeInTheDocument();
    expect(screen.getByText("coverageInProgress: 1")).toBeInTheDocument();
    expect(screen.queryByText(/coverageNotRun/)).not.toBeInTheDocument();
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
    expect(screen.getByText("coverageNotRun: 2")).toBeInTheDocument();
  });
});
