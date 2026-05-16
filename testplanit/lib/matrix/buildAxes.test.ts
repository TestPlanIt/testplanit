import { describe, expect, it } from "vitest";

import { buildAxes, cartesianProduct } from "./buildAxes";
import type {
  CellSummary,
  ConfigAxisItem,
  ParamRowAxisItem,
  StatusMapEntry,
} from "./types";
import { cellKey } from "./types";

const STATUS_PASS: StatusMapEntry = {
  id: 1,
  name: "Pass",
  isSuccess: true,
  isFailure: false,
  isCompleted: true,
  order: 1,
  colorValue: "#10b981",
};

const STATUS_MAP: Record<number, StatusMapEntry> = { 1: STATUS_PASS };

function makeCell(
  caseId: number,
  configId: number,
  rowIndex: number
): CellSummary {
  return {
    caseId,
    configId,
    rowIndex,
    iterationCount: 1,
    pass: 1,
    fail: 0,
    notRun: 0,
    other: 0,
    worstOfStatusId: 1,
    mostRecentCompletedAt: "2026-05-01T08:30:00.000Z",
    iterations: [
      {
        id: 100 + rowIndex,
        rowIndex,
        label: null,
        statusId: 1,
        runId: 200,
        runName: "Run 1",
        runIsCompleted: false,
        completedAt: null,
      },
    ],
  };
}

describe("buildAxes", () => {
  it("returns empty AxesShape for zero cases", () => {
    const axes = buildAxes({
      cases: [],
      configs: [],
      cells: [],
      paramRowsByCaseId: new Map(),
      statusMap: STATUS_MAP,
    });
    expect(axes.caseAxis).toEqual([]);
    expect(axes.configAxis).toEqual([]);
    expect(axes.cells.size).toBe(0);
    expect(axes.cellCount).toBe(0);
    expect(axes.statusMap).toBe(STATUS_MAP);
  });

  it("case with no resolved param rows collapses to zero cells (parameterized case with no dataset snapshot yet)", () => {
    const axes = buildAxes({
      cases: [
        {
          caseId: 1,
          caseName: "Login flow",
          hasParameters: true,
          source: "MANUAL",
          automated: false,
          parameters: [],
        },
      ],
      configs: [{ configId: 0, configName: "(none)" }],
      cells: [],
      paramRowsByCaseId: new Map(),
      statusMap: STATUS_MAP,
    });
    expect(axes.caseAxis[0].hasParameters).toBe(true);
    // No dataset snapshot resolved → empty paramRows → contributes 0 cells.
    expect(axes.caseAxis[0].paramRows).toEqual([]);
    expect(axes.cellCount).toBe(0);
  });

  it("per-case sub-axis math: (3 + 5) × 2 = 16 (Lock A)", () => {
    const caseA: ParamRowAxisItem[] = Array.from({ length: 3 }, (_, i) => ({
      index: i,
      label: `A row ${i}`,
      values: {},
    }));
    const caseB: ParamRowAxisItem[] = Array.from({ length: 5 }, (_, i) => ({
      index: i,
      label: `B row ${i}`,
      values: {},
    }));

    const axes = buildAxes({
      cases: [
        {
          caseId: 1,
          caseName: "A",
          hasParameters: true,
          source: "MANUAL",
          automated: false,
          parameters: [],
        },
        {
          caseId: 2,
          caseName: "B",
          hasParameters: true,
          source: "MANUAL",
          automated: false,
          parameters: [],
        },
      ],
      configs: [
        { configId: 10, configName: "Chrome" },
        { configId: 20, configName: "Firefox" },
      ],
      cells: [],
      paramRowsByCaseId: new Map([
        [1, caseA],
        [2, caseB],
      ]),
      statusMap: STATUS_MAP,
    });

    expect(axes.cellCount).toBe(16);
    // Confirm we did NOT compute (3 × 5 × 2) = 30 (global axis math, RESEARCH Pitfall 3).
    expect(axes.cellCount).not.toBe(30);
  });

  it("cell map keying: cells are looked up by cellKey()", () => {
    const cell = makeCell(7, 3, 2);
    const axes = buildAxes({
      cases: [
        {
          caseId: 7,
          caseName: "X",
          hasParameters: false,
          source: "MANUAL",
          automated: false,
          parameters: null,
        },
      ],
      configs: [{ configId: 3, configName: "C3" }],
      cells: [cell],
      paramRowsByCaseId: new Map(),
      statusMap: STATUS_MAP,
    });
    expect(axes.cells.get(cellKey(7, 3, 2))).toBe(cell);
    expect(axes.cells.get("7|3|2")).toBe(cell);
    expect(axes.cells.get(cellKey(7, 3, 99))).toBeUndefined();
  });

  it("status map passthrough preserves the input identity", () => {
    const axes = buildAxes({
      cases: [],
      configs: [],
      cells: [],
      paramRowsByCaseId: new Map(),
      statusMap: STATUS_MAP,
    });
    expect(axes.statusMap).toBe(STATUS_MAP);
    expect(axes.statusMap[1].name).toBe("Pass");
  });

  it("sentinel config (configId === 0) is preserved verbatim", () => {
    const sentinel: ConfigAxisItem = { configId: 0, configName: "(none)" };
    const cell = makeCell(1, 0, 0);
    const axes = buildAxes({
      cases: [
        {
          caseId: 1,
          caseName: "A",
          hasParameters: false,
          source: "MANUAL",
          automated: false,
          parameters: null,
        },
      ],
      configs: [sentinel],
      cells: [cell],
      paramRowsByCaseId: new Map(),
      statusMap: STATUS_MAP,
    });
    expect(axes.configAxis[0]).toBe(sentinel);
    expect(axes.cells.get(cellKey(1, 0, 0))).toBe(cell);
  });

  it("determinism: same input -> same output insertion order", () => {
    const inputs = {
      cases: [
        {
          caseId: 1,
          caseName: "A",
          hasParameters: false,
          source: "MANUAL",
          automated: false,
          parameters: null,
        },
        {
          caseId: 2,
          caseName: "B",
          hasParameters: false,
          source: "MANUAL",
          automated: false,
          parameters: null,
        },
      ],
      configs: [{ configId: 5, configName: "C5" }],
      cells: [makeCell(1, 5, 0), makeCell(2, 5, 0)],
      paramRowsByCaseId: new Map(),
      statusMap: STATUS_MAP,
    };
    const a = buildAxes(inputs);
    const b = buildAxes(inputs);
    expect(Array.from(a.cells.entries())).toEqual(
      Array.from(b.cells.entries())
    );
  });
});

describe("cartesianProduct", () => {
  it("empty input returns [[]] (matches the existing helpers' base case)", () => {
    expect(cartesianProduct([])).toEqual([[]]);
  });

  it("two arrays of two: 2 × 2 = 4 tuples", () => {
    expect(
      cartesianProduct([
        [1, 2],
        [3, 4],
      ])
    ).toEqual([
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
    ]);
  });

  it("three single-element arrays: one tuple of three", () => {
    expect(cartesianProduct([["a"], ["b"], ["c"]])).toEqual([["a", "b", "c"]]);
  });

  it("an empty inner array collapses the product to []", () => {
    expect(cartesianProduct([[1, 2], []])).toEqual([]);
    expect(cartesianProduct([[], [3, 4]])).toEqual([]);
  });

  it("preserves T (generic) — works for objects", () => {
    const out = cartesianProduct([[{ a: 1 }, { a: 2 }], [{ b: 1 }]]);
    expect(out).toEqual([
      [{ a: 1 }, { b: 1 }],
      [{ a: 2 }, { b: 1 }],
    ]);
  });
});
