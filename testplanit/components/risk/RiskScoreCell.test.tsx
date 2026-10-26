import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RiskScoreCell } from "./RiskScoreCell";

// The cell's job is to render whatever the column hands it, including rows
// written by an older version of the scorer; keys stand in for copy.
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(
    () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  ),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: null })),
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: string }) => <span>{String(date)}</span>,
}));

function reasons(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    configHash: "abc123",
    components: [
      { key: "failureHistory", raw: 1, weight: 30, points: 29.7 },
      { key: "flakiness", raw: 0, weight: 15, points: 0 },
      { key: "staleness", raw: 0.5, weight: 15, points: 7.4 },
      { key: "criticality", raw: 0, weight: 26, points: 0 },
      { key: "defects", raw: 0, weight: 15, points: 0 },
    ],
    facts: {
      verdictsSampled: 1,
      failCount: 1,
      flips: 0,
      lastExecutedAt: "2026-08-04T00:00:00.000Z",
      requirementCount: 0,
      topRequirementPriority: null,
      suspectLinkCount: 0,
      defectCount: 0,
      topDefectPriority: null,
      caseCriticality: null,
      quarantined: false,
      ...((overrides.facts as object) ?? {}),
    },
    ...overrides,
  };
}

describe("RiskScoreCell", () => {
  it("renders a placeholder for a case that has never been scored", () => {
    render(<RiskScoreCell score={null} reasons={null} />);
    expect(screen.getByTestId("risk-score-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("risk-score-badge")).not.toBeInTheDocument();
  });

  it("renders the rounded score on the badge", () => {
    render(<RiskScoreCell score={44.6} reasons={reasons()} />);
    expect(screen.getByTestId("risk-score-badge")).toHaveTextContent("45");
  });

  it("survives a malformed reasons value instead of crashing the list", () => {
    // RepositoryCases.riskReasons is Json: a row written by an older or
    // broken writer must degrade, never throw during a table render.
    for (const bad of [
      { components: {} },
      { components: [{ key: "nope" }] },
      "not an object",
      42,
      null,
    ]) {
      const { unmount } = render(<RiskScoreCell score={10} reasons={bad} />);
      expect(screen.getByTestId("risk-score-badge")).toHaveTextContent("10");
      unmount();
    }
  });
});
