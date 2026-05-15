import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { cellKey, type AxesShape, type CellSummary } from "~/lib/matrix/types";

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <button type="button">{children}</button>),
  PopoverContent: () => null,
}));

/**
 * Cap how many items the virtualizer reports per axis so the
 * "virtualization smoke" test can prove the grid doesn't render every cell
 * in a 100×100 fixture, while the small-fixture tests still see every row +
 * column. The cap mirrors a viewport of ~10 rows × ~10 cols + small
 * overscan — well under the 200 cell ceiling the smoke test asserts.
 */
const VIRTUALIZER_RENDER_CAP = 12;

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number;
    estimateSize: () => number;
  }) => {
    const size = estimateSize();
    const visibleCount = Math.min(count, VIRTUALIZER_RENDER_CAP);
    const items = Array.from({ length: visibleCount }, (_, i) => ({
      index: i,
      key: i,
      start: i * size,
      size,
      end: (i + 1) * size,
      lane: 0,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => count * size,
    };
  },
}));

import { MatrixGrid } from "./MatrixGrid";

/**
 * Build a fixture AxesShape with the requested number of cases and configs.
 * Each case is non-parameterized (single sub-row at index 0). Total cell
 * count = caseCount * configCount.
 */
function buildLargeAxes(caseCount: number, configCount: number): AxesShape {
  const caseAxis = Array.from({ length: caseCount }, (_, i) => ({
    caseId: i + 1,
    caseName: `Case-${i + 1}`,
    hasParameters: false,
    paramRows: [{ index: 0, label: null, values: {} }],
  }));
  const configAxis = Array.from({ length: configCount }, (_, j) => ({
    configId: j + 1,
    configName: `Config-${j + 1}`,
  }));
  const cells = new Map<string, CellSummary>();
  for (let i = 0; i < caseCount; i++) {
    for (let j = 0; j < configCount; j++) {
      const k = cellKey(i + 1, j + 1, 0);
      cells.set(k, {
        caseId: i + 1,
        configId: j + 1,
        rowIndex: 0,
        iterationCount: 1,
        pass: 1,
        fail: 0,
        notRun: 0,
        other: 0,
        worstOfStatusId: 1,
        mostRecentCompletedAt: "2026-05-01T00:00:00.000Z",
        iterations: [],
      });
    }
  }
  return {
    caseAxis,
    configAxis,
    cells,
    cellCount: caseCount * configCount,
    statusMap: {
      1: {
        id: 1,
        name: "Passed",
        isSuccess: true,
        isFailure: false,
        isCompleted: true,
        order: 1,
        colorValue: "#00ff00",
      },
    },
  };
}

describe("<MatrixGrid />", () => {
  it("mounts the four sticky regions (corner, headers, rail, viewport)", () => {
    const axes = buildLargeAxes(5, 5);
    render(<MatrixGrid axes={axes} projectId={42} />);
    expect(screen.getByTestId("matrix-grid")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-corner")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-column-headers")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-left-rail")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-data-viewport")).toBeInTheDocument();
  });

  it("renders one column-header per config (≤ 100, all rendered eagerly)", () => {
    const axes = buildLargeAxes(2, 5);
    render(<MatrixGrid axes={axes} projectId={42} />);
    expect(screen.getAllByTestId(/^matrix-column-header-/).length).toBe(5);
  });

  it("virtualization smoke: a 100×100 = 10000-cell fixture renders well under 200 cells in the DOM", () => {
    const axes = buildLargeAxes(100, 100);
    render(<MatrixGrid axes={axes} projectId={42} />);
    // jsdom has no real layout so the virtualizer has no scroll viewport
    // dimensions to compute against; the rendered cell count is whatever
    // the overscan window produces with size-zero estimates. The contract
    // we care about: the virtualizer does NOT eagerly render all 10000
    // cells. A safe ceiling is 200 (overscan defaults are 8 rows × 4 cols
    // = 32 cells, plus headers/rail).
    const cellCount =
      screen.queryAllByTestId(/^matrix-cell-/).length +
      screen.queryAllByTestId(/^matrix-cell-not-run-/).length;
    expect(cellCount).toBeLessThan(200);
  });

  it("a small 3-case × 2-config fixture renders the expected case rows in the rail", () => {
    const axes = buildLargeAxes(3, 2);
    render(<MatrixGrid axes={axes} projectId={42} />);
    // First sub-row of every case gets a `matrix-row-case-<caseId>` test id.
    expect(screen.getByTestId("matrix-row-case-1")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-row-case-2")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-row-case-3")).toBeInTheDocument();
  });

  it("parameterized case shows continuation sub-rows (matrix-row-sub-*) for paramRows beyond index 0", () => {
    const cells = new Map<string, CellSummary>();
    cells.set(cellKey(1, 1, 0), {
      caseId: 1,
      configId: 1,
      rowIndex: 0,
      iterationCount: 1,
      pass: 1,
      fail: 0,
      notRun: 0,
      other: 0,
      worstOfStatusId: 1,
      mostRecentCompletedAt: "2026-05-01T00:00:00.000Z",
      iterations: [],
    });
    cells.set(cellKey(1, 1, 1), {
      caseId: 1,
      configId: 1,
      rowIndex: 1,
      iterationCount: 1,
      pass: 1,
      fail: 0,
      notRun: 0,
      other: 0,
      worstOfStatusId: 1,
      mostRecentCompletedAt: "2026-05-01T00:00:00.000Z",
      iterations: [],
    });
    const axes: AxesShape = {
      caseAxis: [
        {
          caseId: 1,
          caseName: "Login",
          hasParameters: true,
          paramRows: [
            { index: 0, label: "creds-1", values: { username: "alice" } },
            { index: 1, label: "creds-2", values: { username: "bob" } },
          ],
        },
      ],
      configAxis: [{ configId: 1, configName: "Chrome" }],
      cells,
      cellCount: 2,
      statusMap: {
        1: {
          id: 1,
          name: "Passed",
          isSuccess: true,
          isFailure: false,
          isCompleted: true,
          order: 1,
          colorValue: "#00ff00",
        },
      },
    };
    render(<MatrixGrid axes={axes} projectId={42} />);
    expect(screen.getByTestId("matrix-row-case-1")).toBeInTheDocument();
    expect(screen.getByTestId("matrix-row-sub-1-1")).toBeInTheDocument();
  });
});
