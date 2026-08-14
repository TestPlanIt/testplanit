import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CollapsibleSummarySection } from "./CollapsibleSummarySection";

// Mock next-intl — keys render as-is so assertions target key names.
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));

const STORAGE_KEY = "tpi.runs.1.summaryCollapsed";

describe("CollapsibleSummarySection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders expanded by default with its children visible", () => {
    render(
      <CollapsibleSummarySection storageKey={STORAGE_KEY}>
        <div data-testid="charts" />
      </CollapsibleSummarySection>
    );
    expect(screen.getByTestId("summary-section-toggle")).toHaveAttribute(
      "data-state",
      "open"
    );
    expect(screen.getByTestId("charts")).toBeInTheDocument();
  });

  it("collapses on toggle and persists the choice", () => {
    render(
      <CollapsibleSummarySection storageKey={STORAGE_KEY}>
        <div data-testid="charts" />
      </CollapsibleSummarySection>
    );
    fireEvent.click(screen.getByTestId("summary-section-toggle"));
    expect(screen.getByTestId("summary-section-toggle")).toHaveAttribute(
      "data-state",
      "closed"
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("collapsed");

    fireEvent.click(screen.getByTestId("summary-section-toggle"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("expanded");
  });

  it("hydrates a stored collapsed state", () => {
    window.localStorage.setItem(STORAGE_KEY, "collapsed");
    render(
      <CollapsibleSummarySection storageKey={STORAGE_KEY}>
        <div data-testid="charts" />
      </CollapsibleSummarySection>
    );
    expect(screen.getByTestId("summary-section-toggle")).toHaveAttribute(
      "data-state",
      "closed"
    );
  });

  it("renders a custom title when provided, the shared Summary label otherwise", () => {
    const { unmount } = render(
      <CollapsibleSummarySection storageKey={STORAGE_KEY} title="Metrics">
        <div />
      </CollapsibleSummarySection>
    );
    expect(screen.getByTestId("summary-section-toggle")).toHaveTextContent(
      "Metrics"
    );
    unmount();

    render(
      <CollapsibleSummarySection storageKey={STORAGE_KEY}>
        <div />
      </CollapsibleSummarySection>
    );
    expect(screen.getByTestId("summary-section-toggle")).toHaveTextContent(
      "fields.summary"
    );
  });

  it("keeps separate state per storage key", () => {
    window.localStorage.setItem("tpi.sessions.1.summaryCollapsed", "collapsed");
    render(
      <CollapsibleSummarySection storageKey={STORAGE_KEY}>
        <div data-testid="charts" />
      </CollapsibleSummarySection>
    );
    expect(screen.getByTestId("summary-section-toggle")).toHaveAttribute(
      "data-state",
      "open"
    );
  });
});
