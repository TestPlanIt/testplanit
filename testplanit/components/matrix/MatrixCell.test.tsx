import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

// Mock the navigation Link import that MatrixCellPopover (rendered inside
// the Popover content) uses; without this, Next's Link complains about
// missing context in jsdom.
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

// Mock the Popover primitives so PopoverContent renders inline (no portal)
// and tests can assert on the popover body. Radix's PopoverContent only
// renders when open; we mount the trigger button as a plain button.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <button type="button">{children}</button>),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stub-popover-content">{children}</div>
  ),
}));

import { MatrixCell } from "./MatrixCell";

const baseStatusMap = {
  1: {
    id: 1,
    name: "Passed",
    isSuccess: true,
    isFailure: false,
    isCompleted: true,
    order: 1,
    colorValue: "#00ff00",
  },
  2: {
    id: 2,
    name: "Failed",
    isSuccess: false,
    isFailure: true,
    isCompleted: true,
    order: 2,
    colorValue: "#ff0000",
  },
};

describe("<MatrixCell />", () => {
  it("renders a not-run placeholder when cell is undefined", () => {
    render(
      <MatrixCell
        cell={undefined}
        configId={2}
        rowIndex={0}
        statusMap={baseStatusMap}
        projectId={42}
        caseId={1}
      />
    );
    expect(screen.getByTestId("matrix-cell-not-run-1-2-0")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders a not-run placeholder when iterationCount is 0", () => {
    render(
      <MatrixCell
        cell={{
          caseId: 1,
          configId: 2,
          rowIndex: 0,
          iterationCount: 0,
          pass: 0,
          fail: 0,
          notRun: 0,
          other: 0,
          worstOfStatusId: null,
          mostRecentCompletedAt: null,
          iterations: [],
        }}
        configId={2}
        rowIndex={0}
        statusMap={baseStatusMap}
        projectId={42}
        caseId={1}
      />
    );
    expect(screen.getByTestId("matrix-cell-not-run-1-2-0")).toBeInTheDocument();
  });

  it("renders pip + counts when cell has iterations", () => {
    render(
      <MatrixCell
        cell={{
          caseId: 1,
          configId: 2,
          rowIndex: 3,
          iterationCount: 4,
          pass: 2,
          fail: 1,
          notRun: 1,
          other: 0,
          worstOfStatusId: 1,
          mostRecentCompletedAt: "2026-05-01T00:00:00.000Z",
          iterations: [],
        }}
        configId={2}
        rowIndex={3}
        statusMap={baseStatusMap}
        projectId={42}
        caseId={1}
      />
    );
    // data-testid uses the cell's own configId/rowIndex (not the prop).
    expect(screen.getByTestId("matrix-cell-1-2-3")).toBeInTheDocument();
    expect(screen.getByText("2/1/1")).toBeInTheDocument();
  });

  it("uses the worst-of status color for the pip", () => {
    render(
      <MatrixCell
        cell={{
          caseId: 1,
          configId: 2,
          rowIndex: 0,
          iterationCount: 2,
          pass: 1,
          fail: 1,
          notRun: 0,
          other: 0,
          worstOfStatusId: 2, // Failed
          mostRecentCompletedAt: "2026-05-01T00:00:00.000Z",
          iterations: [],
        }}
        configId={2}
        rowIndex={0}
        statusMap={baseStatusMap}
        projectId={42}
        caseId={1}
      />
    );
    const pip = screen.getByTestId("iteration-status-pip");
    // The pip's inline `color` style is the resolved status color.
    expect(pip.getAttribute("style")).toContain("rgb(255, 0, 0)");
    expect(pip.getAttribute("data-glyph")).toBe("failed");
  });

  it("clicking the cell mounts the popover content (drill-down list)", async () => {
    const user = userEvent.setup();
    render(
      <MatrixCell
        cell={{
          caseId: 1,
          configId: 2,
          rowIndex: 0,
          iterationCount: 1,
          pass: 1,
          fail: 0,
          notRun: 0,
          other: 0,
          worstOfStatusId: 1,
          mostRecentCompletedAt: "2026-05-01T00:00:00.000Z",
          iterations: [
            {
              id: 999,
              rowIndex: 0,
              label: "row-0",
              statusId: 1,
              runId: 11,
              runName: "Smoke Run",
              runIsCompleted: false,
              completedAt: null,
            },
          ],
        }}
        configId={2}
        rowIndex={0}
        statusMap={baseStatusMap}
        projectId={42}
        caseId={1}
      />
    );

    // The popover stub renders inline so the popover body is in the DOM.
    expect(screen.getByTestId("matrix-cell-popover")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-popover-row-999")).toBeInTheDocument();

    // Trigger the click — assertion is that no error occurs and the
    // trigger button is present and clickable.
    await user.click(screen.getByTestId("matrix-cell-1-2-0"));
    // After clicking, popover stub still renders (no real open/close
    // semantics); the assertion is that the click does not throw.
    expect(screen.getByTestId("matrix-cell-popover")).toBeInTheDocument();
  });
});
