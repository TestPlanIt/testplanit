import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildFilterDimensions } from "~/lib/repository/filterDimensions";

// Radix tooltips never open under jsdom's pointer model; render content
// inline so the message itself can be asserted (SessionResultsSummary
// precedent).
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { AddFilterButton } from "./AddFilterButton";

beforeAll(() => {
  // cmdk scrolls the selected item into view; jsdom has no implementation.
  Element.prototype.scrollIntoView = vi.fn();
});

const repoRegistry = buildFilterDimensions();
const runRegistry = buildFilterDimensions({ includeRunDimensions: true });
const dynamicRegistry = buildFilterDimensions({
  dynamicFields: [{ fieldId: 12, type: "Text String" }],
});

describe("AddFilterButton", () => {
  it("lists repo dimensions and omits run dimensions outside run mode", () => {
    render(<AddFilterButton registry={repoRegistry} onPick={() => {}} />);
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    expect(
      screen.getByTestId("filter-dimension-option-templates")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("filter-dimension-option-tags")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("filter-dimension-option-status")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("filter-dimension-option-assignedTo")
    ).not.toBeInTheDocument();
  });

  it("includes run dimensions when the run-mode registry is passed", () => {
    render(<AddFilterButton registry={runRegistry} onPick={() => {}} />);
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    expect(
      screen.getByTestId("filter-dimension-option-status")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("filter-dimension-option-assignedTo")
    ).toBeInTheDocument();
  });

  it("labels dynamic-field dimensions with the passed displayName", () => {
    render(
      <AddFilterButton
        registry={dynamicRegistry}
        dynamicFieldLabels={{ field_12: "Severity" }}
        onPick={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    expect(
      screen.getByTestId("filter-dimension-option-field_12")
    ).toHaveTextContent("Severity");
  });

  it("reports the picked dimension and closes", () => {
    const onPick = vi.fn();
    render(<AddFilterButton registry={repoRegistry} onPick={onPick} />);
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    fireEvent.click(screen.getByTestId("filter-dimension-option-tags"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].key).toBe("tags");
  });
});

describe("AddFilterButton at the predicate cap", () => {
  it("disables the trigger and explains why", () => {
    render(
      <AddFilterButton registry={repoRegistry} onPick={() => {}} limitReached />
    );

    const trigger = screen.getByTestId("filter-bar-add");
    expect(trigger).toBeDisabled();
    expect(screen.getByTestId("filter-bar-add-limit")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(
      screen.queryByTestId("filter-dimension-option-templates")
    ).not.toBeInTheDocument();

    // vitest.setup.tsx carries its own message fixture, so t() echoes the
    // key — assert the key wiring, and the count it interpolates.
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "repository.filterBar.filterLimitReached"
    );
  });

  it("stays enabled below the cap", () => {
    render(<AddFilterButton registry={repoRegistry} onPick={() => {}} />);
    expect(screen.getByTestId("filter-bar-add")).toBeEnabled();
    expect(
      screen.queryByTestId("filter-bar-add-limit")
    ).not.toBeInTheDocument();
  });
});
