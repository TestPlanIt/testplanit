// The traceability report's visualization panel: donut + tiles + the
// coverage-by-hierarchy bars. The seams under test are the client-side
// aggregations — per-requirement dedupe into donut arcs, and root
// grouping (first parent-path segment, or the requirement itself when
// top-level) with the tail folded into "Other". The d3 donut is stubbed
// to capture its props; the layout primitives render for real.

import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => "en-US",
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => (
    <span data-testid="tooltip-content">{children}</span>
  ),
}));

const capturedDonut: { current: any } = { current: null };
vi.mock("@/components/dataVisualizations/TestRunResultsDonut", () => ({
  default: (props: any) => {
    capturedDonut.current = props;
    return <div data-testid="donut-stub" />;
  },
}));

import {
  REQUIREMENT_COVERAGE_CHART_COLORS,
  REQUIREMENT_COVERAGE_STATE_ORDER,
  RequirementCoverageOverview,
} from "./RequirementCoverageOverview";

function row(
  requirementId: number,
  coverageStatus: string,
  requirementParentPath = "",
  requirementKey = `REQ-${requirementId}`
) {
  return {
    requirementId,
    coverageStatus,
    requirementParentPath,
    requirementKey,
    requirementTitle: null,
  };
}

describe("RequirementCoverageOverview", () => {
  beforeEach(() => {
    capturedDonut.current = null;
  });

  it("feeds the donut per-requirement state counts in the shared order, zero states omitted", () => {
    render(
      <RequirementCoverageOverview
        rows={[
          // Requirement 1 has three covering-case rows — one requirement.
          row(1, "PASSED"),
          row(1, "PASSED"),
          row(1, "PASSED"),
          row(2, "UNCOVERED"),
          row(3, "UNCOVERED"),
          row(4, "NOT_RUN"),
        ]}
      />
    );

    expect(capturedDonut.current.data).toEqual([
      {
        id: "PASSED",
        name: "statusPassed",
        value: 1,
        color: REQUIREMENT_COVERAGE_CHART_COLORS.PASSED,
      },
      {
        id: "NOT_RUN",
        name: "statusNotRun",
        value: 1,
        color: REQUIREMENT_COVERAGE_CHART_COLORS.NOT_RUN,
      },
      {
        id: "UNCOVERED",
        name: "uncovered",
        value: 2,
        color: REQUIREMENT_COVERAGE_CHART_COLORS.UNCOVERED,
      },
    ]);
  });

  it("groups requirements by their root — first parent-path segment, or themselves when top-level", () => {
    render(
      <RequirementCoverageOverview
        rows={[
          // The "Enrolments" hierarchy: the root itself plus two nested
          // requirements (one a grandchild — still the SAME root).
          row(10, "PASSED", "", "Enrolments"),
          row(11, "FAILED", "Enrolments"),
          row(12, "UNCOVERED", "Enrolments > Domestic"),
          // A lone top-level requirement is its own hierarchy of one.
          row(20, "UNCOVERED", "", "Integrations"),
        ]}
      />
    );

    const first = screen.getByTestId("requirement-hierarchy-bar-0");
    expect(first).toHaveTextContent("Enrolments");
    expect(first).toHaveTextContent("3");
    // The root's own row (id 10) supplies the id — the label links out.
    expect(first.querySelector("a")).toHaveAttribute("href", "/requirement/10");
    expect(
      screen.getByTestId("hierarchy-segment-0-passed")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hierarchy-segment-0-failed")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("hierarchy-segment-0-uncovered")
    ).toBeInTheDocument();

    const second = screen.getByTestId("requirement-hierarchy-bar-1");
    expect(second).toHaveTextContent("Integrations");
    expect(second).toHaveTextContent("1");
  });

  it("folds hierarchies past the top ten into a labeled Other bar", () => {
    const rows = [];
    for (let root = 1; root <= 13; root++) {
      // Root r contributes r requirements so ranking is deterministic:
      // roots 13..4 stay, roots 3, 2, 1 (6 requirements) fold.
      for (let i = 0; i < root; i++) {
        rows.push(
          row(
            root * 100 + i,
            "UNCOVERED",
            i === 0 ? "" : `Root ${root}`,
            `Root ${root}`
          )
        );
      }
    }

    render(<RequirementCoverageOverview rows={rows} />);

    const bars = screen.getAllByTestId(/requirement-hierarchy-bar-/);
    expect(bars).toHaveLength(10);
    // No silent caps: the fold is a labeled FOOTNOTE row, not a bar — a
    // tail of thousands of single-requirement roots would otherwise own
    // the length scale and crush every real hierarchy's bar.
    const other = screen.getByTestId("requirement-hierarchy-other");
    expect(other).toHaveTextContent('otherRoots:{"count":3}');
    expect(other).toHaveTextContent("6");
  });

  it("renders nothing for an empty result set", () => {
    const { container } = render(<RequirementCoverageOverview rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps every adjacent pair in the shared state order distinct in the palette", () => {
    // A tripwire, not a re-run of the validator: the order and hexes were
    // validated together (CVD ΔE ≥ 8 per adjacent pair, wrap included) —
    // changing either invalidates that run, so pin both.
    expect(REQUIREMENT_COVERAGE_STATE_ORDER).toEqual([
      "PASSED",
      "NOT_RUN",
      "UNCOVERED",
      "FAILED",
    ]);
    expect(REQUIREMENT_COVERAGE_CHART_COLORS).toEqual({
      PASSED: "#22c55e",
      NOT_RUN: "#6b7280",
      UNCOVERED: "#f59e0b",
      FAILED: "#dc2626",
    });
  });
});
