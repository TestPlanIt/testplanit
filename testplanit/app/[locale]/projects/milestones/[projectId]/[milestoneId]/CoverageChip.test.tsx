import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  CoverageChip,
  coverageSortValue,
  hasCompletedCoverage,
} from "./CoverageChip";

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

  it("shows the Uncovered badge when linked cases have no completed outcome, with the untested tooltip", () => {
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
    // No isCompleted=true statuses in scope ⇒ Uncovered, even though cases
    // are linked; the tooltip preserves the untested count.
    const badge = screen.getByText("coverageUncovered");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", "labels.untested: 2");
  });

  it("with uncoveredWhen=no-linked-cases, renders an Untested pip (not the Uncovered badge) for linked-but-unexecuted cases", () => {
    render(
      <CoverageChip
        uncoveredWhen="no-linked-cases"
        breakdown={{
          linkedCaseCount: 3,
          passed: 0,
          failed: 0,
          inProgress: 0,
          notRun: 3,
          uncovered: false,
          statuses: [],
          untested: 3,
        }}
      />
    );
    expect(screen.queryByText("coverageUncovered")).not.toBeInTheDocument();
    expect(screen.getByLabelText("labels.untested: 3")).toBeInTheDocument();
  });

  it("with uncoveredWhen=no-linked-cases, still shows the Uncovered badge when nothing is linked", () => {
    render(
      <CoverageChip
        uncoveredWhen="no-linked-cases"
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
    expect(screen.getByText("coverageUncovered")).toBeInTheDocument();
  });
});

describe("coverageSortValue / hasCompletedCoverage", () => {
  const covered = {
    linkedCaseCount: 5,
    passed: 3,
    failed: 1,
    inProgress: 0,
    notRun: 1,
    uncovered: false,
    statuses: [
      { statusId: 1, name: "Passed", color: null, count: 3 },
      { statusId: 2, name: "Failed", color: null, count: 1 },
    ],
    untested: 1,
  };

  it("groups every displayed-Uncovered variant at the same sort value", () => {
    const noBreakdown = coverageSortValue(undefined);
    const noCases = coverageSortValue({
      ...covered,
      linkedCaseCount: 0,
      statuses: [],
      uncovered: true,
      untested: 0,
    });
    // Linked cases but zero completed outcomes — previously interleaved
    // by linkedCaseCount when sorting.
    const linkedButNeverCompleted = coverageSortValue({
      ...covered,
      linkedCaseCount: 27,
      statuses: [],
      untested: 27,
    });
    expect(noBreakdown).toBe(-1);
    expect(noCases).toBe(-1);
    expect(linkedButNeverCompleted).toBe(-1);
  });

  it("orders covered rows by completed-outcome total", () => {
    expect(coverageSortValue(covered)).toBe(4);
    expect(hasCompletedCoverage(covered)).toBe(true);
  });
});
