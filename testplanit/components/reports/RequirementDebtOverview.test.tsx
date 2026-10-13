// The coverage-debt report's visualization panel. The seams under test
// are the client-side aggregations: tier counts, the closed-status
// display heuristic, root grouping, and the aging buckets computed from
// Uncovered Since.

import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

import { RequirementDebtOverview } from "./RequirementDebtOverview";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function row(requirementId: number, overrides: Record<string, unknown> = {}) {
  return {
    requirementId,
    coverageStatus: "UNCOVERED",
    requirementStatus: null,
    requirementParentPath: "",
    requirementKey: `REQ-${requirementId}`,
    requirementTitle: null,
    requirementCreatedAt: daysAgo(5),
    ...overrides,
  };
}

describe("RequirementDebtOverview", () => {
  it("counts the tiers and the closed-status slice", () => {
    render(
      <RequirementDebtOverview
        rows={[
          row(1),
          row(2, { requirementStatus: "Closed" }),
          row(3, { coverageStatus: "NOT_RUN", requirementStatus: "DONE" }),
          row(4, { requirementStatus: "In Progress" }),
        ]}
      />
    );

    expect(screen.getByTestId("debt-summary-total")).toHaveTextContent("4");
    expect(screen.getByTestId("debt-summary-uncovered")).toHaveTextContent("3");
    expect(screen.getByTestId("debt-summary-not_run")).toHaveTextContent("1");
    // "Closed" and "DONE" match the display heuristic case-insensitively;
    // "In Progress" does not.
    expect(screen.getByTestId("debt-summary-on-closed")).toHaveTextContent("2");
  });

  it("groups debt by root hierarchy with both tier segments", () => {
    render(
      <RequirementDebtOverview
        rows={[
          row(1, { requirementKey: "Enrolments" }),
          row(2, { requirementParentPath: "Enrolments" }),
          row(3, {
            requirementParentPath: "Enrolments",
            coverageStatus: "NOT_RUN",
          }),
          row(4, { requirementKey: "Integrations" }),
        ]}
      />
    );

    const first = screen.getByTestId("debt-hierarchy-bar-0");
    expect(first).toHaveTextContent("Enrolments");
    expect(first).toHaveTextContent("3");
    // The root itself appeared as a row (id 1), so its label links to
    // the requirement's details.
    expect(first.querySelector("a")).toHaveAttribute("href", "/requirement/1");
    expect(
      screen.getByTestId("debt-hierarchy-segment-0-uncovered")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("debt-hierarchy-segment-0-not_run")
    ).toBeInTheDocument();
  });

  it("links a group discovered only through descendants via the server root id", () => {
    // The root "Enrolments" (id 50) has no debt row of its own — only its
    // children appear — yet the bar still links because every row carries
    // requirementRootId.
    render(
      <RequirementDebtOverview
        rows={[
          row(2, {
            requirementParentPath: "Enrolments",
            requirementRootId: 50,
          }),
          row(3, {
            requirementParentPath: "Enrolments",
            requirementRootId: 50,
          }),
        ]}
      />
    );

    expect(
      screen.getByTestId("debt-hierarchy-bar-0").querySelector("a")
    ).toHaveAttribute("href", "/requirement/50");
  });

  it("buckets debt age from Uncovered Since", () => {
    render(
      <RequirementDebtOverview
        rows={[
          row(1, { requirementCreatedAt: daysAgo(3) }),
          row(2, { requirementCreatedAt: daysAgo(45) }),
          row(3, { requirementCreatedAt: daysAgo(200) }),
          row(4, { requirementCreatedAt: daysAgo(400) }),
          row(5, { requirementCreatedAt: daysAgo(500) }),
        ]}
      />
    );

    const bars = screen.getAllByTestId(/debt-aging-bar-/);
    expect(bars).toHaveLength(5);
    // Aging buckets aren't requirements — never links.
    expect(bars[0].querySelector("a")).toBeNull();
    expect(bars[0]).toHaveTextContent("ageUnder30");
    expect(bars[0]).toHaveTextContent("1");
    expect(bars[1]).toHaveTextContent("age30to90");
    expect(bars[1]).toHaveTextContent("1");
    // daysAgo(200) sits in [180,365); the 90–180 bucket is empty but
    // still renders so the scale reads honestly.
    expect(bars[2]).toHaveTextContent("age90to180");
    expect(bars[2]).toHaveTextContent("0");
    expect(bars[3]).toHaveTextContent("age180to365");
    expect(bars[3]).toHaveTextContent("1");
    expect(bars[4]).toHaveTextContent("ageOver365");
    expect(bars[4]).toHaveTextContent("2");
  });

  it("renders nothing for an empty result set", () => {
    const { container } = render(<RequirementDebtOverview rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
