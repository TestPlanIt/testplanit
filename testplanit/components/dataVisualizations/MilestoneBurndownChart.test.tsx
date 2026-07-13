import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MilestoneBurndownData } from "~/lib/services/milestoneBurndown";
import MilestoneBurndownChart from "./MilestoneBurndownChart";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Give the responsive hook real dimensions so the d3 draw path executes
// (with 0×0 it would early-return and cover nothing).
vi.mock("~/hooks/useResponsiveSVG", () => ({
  default: () => ({ width: 400, height: 260 }),
}));

const withTarget: MilestoneBurndownData = {
  milestoneId: 1,
  total: 4,
  start: "2026-03-01",
  end: "2026-03-05",
  hasTarget: true,
  actual: [
    { date: "2026-03-01", remaining: 3 },
    { date: "2026-03-02", remaining: 2 },
    { date: "2026-03-03", remaining: 1 },
    { date: "2026-03-04", remaining: 0 },
    { date: "2026-03-05", remaining: 0 },
  ],
};

const empty: MilestoneBurndownData = {
  milestoneId: 1,
  total: 0,
  start: null,
  end: null,
  hasTarget: false,
  actual: [],
};

describe("MilestoneBurndownChart", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("renders an SVG for a series with a target", () => {
    const { container } = render(<MilestoneBurndownChart data={withTarget} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("draws both the ideal and actual paths when a target exists", () => {
    const { container } = render(<MilestoneBurndownChart data={withTarget} />);
    // Two <path> elements: the dashed ideal guideline + the actual line.
    expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(2);
  });

  it("renders gracefully with an empty series", () => {
    const { container } = render(<MilestoneBurndownChart data={empty} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // No data → nothing drawn inside the svg.
    expect(svg?.querySelectorAll("path").length ?? 0).toBe(0);
  });

  it("omits the ideal guideline when there is no target date", () => {
    const noTarget: MilestoneBurndownData = {
      ...withTarget,
      end: null,
      hasTarget: false,
    };
    const { container } = render(<MilestoneBurndownChart data={noTarget} />);
    // Only the actual line path (no dashed ideal line).
    const dashed = Array.from(container.querySelectorAll("path")).filter((p) =>
      p.getAttribute("stroke-dasharray")?.includes("4 4")
    );
    expect(dashed.length).toBe(0);
  });
});
