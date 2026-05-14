import { describe, expect, it } from "vitest";

import { render, screen } from "~/test/test-utils";

import {
  glyphFromStatus,
  IterationStatusPip,
  resolvePipColor,
  type IterationStatusGlyph,
} from "./IterationStatusPip";

describe("IterationStatusPip", () => {
  const allGlyphs: IterationStatusGlyph[] = [
    "notStarted",
    "active",
    "passed",
    "failed",
    "skipped",
    "blocked",
  ];

  it.each(allGlyphs)("renders the %s glyph", (glyph) => {
    render(<IterationStatusPip glyph={glyph} />);
    const pip = screen.getByTestId("iteration-status-pip");
    expect(pip).toBeInTheDocument();
    expect(pip).toHaveAttribute("data-glyph", glyph);
  });

  it("falls back to the muted-foreground token when no statusColor and no special glyph", () => {
    render(<IterationStatusPip glyph="passed" />);
    const pip = screen.getByTestId("iteration-status-pip");
    expect(pip.getAttribute("style") ?? "").toContain("muted-foreground");
  });

  it("uses the primary token for the 'active' pseudo-state when no statusColor", () => {
    render(<IterationStatusPip glyph="active" />);
    const pip = screen.getByTestId("iteration-status-pip");
    expect(pip.getAttribute("style") ?? "").toContain("--primary");
  });

  it("prefers the explicit statusColor for workflow-defined colors", () => {
    render(<IterationStatusPip glyph="failed" statusColor="rgb(255, 0, 0)" />);
    const pip = screen.getByTestId("iteration-status-pip");
    expect(pip.getAttribute("style") ?? "").toContain("rgb(255, 0, 0)");
  });
});

describe("glyphFromStatus", () => {
  it("returns 'active' when active and incomplete", () => {
    expect(glyphFromStatus(undefined, true)).toBe("active");
    expect(glyphFromStatus({ isCompleted: false } as any, true)).toBe("active");
  });

  it("returns 'notStarted' when not active and no status set", () => {
    expect(glyphFromStatus(undefined, false)).toBe("notStarted");
  });

  it("returns 'passed' when status.isSuccess", () => {
    expect(
      glyphFromStatus(
        { isSuccess: true, isFailure: false, isCompleted: true },
        false
      )
    ).toBe("passed");
  });

  it("returns 'failed' when status.isFailure", () => {
    expect(
      glyphFromStatus(
        { isSuccess: false, isFailure: true, isCompleted: true },
        false
      )
    ).toBe("failed");
  });

  it("returns 'blocked' for systemName=blocked completed status", () => {
    expect(
      glyphFromStatus(
        {
          isSuccess: false,
          isFailure: false,
          isCompleted: true,
          systemName: "blocked",
        },
        false
      )
    ).toBe("blocked");
  });

  it("returns 'skipped' for completed non-success non-failure non-blocked", () => {
    expect(
      glyphFromStatus(
        { isSuccess: false, isFailure: false, isCompleted: true },
        false
      )
    ).toBe("skipped");
  });
});

describe("resolvePipColor", () => {
  it("always prefers the explicit statusColor when provided (statuses are color-only)", () => {
    expect(resolvePipColor("notStarted", "#abc")).toBe("#abc");
    expect(resolvePipColor("active", "#abc")).toBe("#abc");
    expect(resolvePipColor("skipped", "#abc")).toBe("#abc");
    expect(resolvePipColor("passed", "#abc")).toBe("#abc");
    expect(resolvePipColor("failed", "#abc")).toBe("#abc");
    expect(resolvePipColor("blocked", "#abc")).toBe("#abc");
  });

  it("falls back to primary for active and muted-foreground otherwise when no statusColor", () => {
    expect(resolvePipColor("active")).toContain("--primary");
    expect(resolvePipColor("notStarted")).toContain("muted-foreground");
    expect(resolvePipColor("passed")).toContain("muted-foreground");
    expect(resolvePipColor("failed")).toContain("muted-foreground");
    expect(resolvePipColor("skipped")).toContain("muted-foreground");
    expect(resolvePipColor("blocked")).toContain("muted-foreground");
  });
});
