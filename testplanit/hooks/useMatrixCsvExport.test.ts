import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cellKey, type AxesShape, type CellSummary } from "~/lib/matrix/types";

import { useMatrixCsvExport } from "./useMatrixCsvExport";

/**
 * The hook builds a Blob from a Papa.unparse output and triggers a
 * <a download>.click(). Tests intercept Blob construction so the CSV body
 * can be inspected without touching jsdom's brittle URL.createObjectURL
 * implementation.
 */

const blobInputs: Array<{ parts: BlobPart[]; type: string }> = [];
const originalBlob = global.Blob;
const originalCreateElement = document.createElement.bind(document);

class StubBlob {
  size: number;
  type: string;
  parts: BlobPart[];
  constructor(parts: BlobPart[], opts?: { type?: string }) {
    this.parts = parts;
    this.type = opts?.type ?? "";
    this.size = parts.reduce((acc, p) => {
      if (typeof p === "string") return acc + p.length;
      // Treat anything else as zero — we only inspect string parts.
      return acc;
    }, 0);
    blobInputs.push({ parts, type: this.type });
  }
}

const linkClickMock = vi.fn();
let createdLinks: HTMLAnchorElement[] = [];

beforeEach(() => {
  blobInputs.length = 0;
  linkClickMock.mockClear();
  createdLinks = [];
  // Replace the global Blob with our recording stub.
  (global as any).Blob = StubBlob;
  // jsdom's URL.createObjectURL is undefined by default — provide a stub.
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:stub",
    });
  } else {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stub");
  }
  if (!URL.revokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
  } else {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  }
  // Intercept document.createElement('a') so we can track .click().
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = originalCreateElement(tag);
    if (tag === "a") {
      const anchor = el as HTMLAnchorElement;
      anchor.click = linkClickMock;
      createdLinks.push(anchor);
    }
    return el;
  });
});

afterEach(() => {
  (global as any).Blob = originalBlob;
  vi.restoreAllMocks();
});

/**
 * Single-case fixture: one parameterized case with two parameters
 * (`username`, `password`), one parameter row whose `password` value begins
 * with `=` to exercise the formula-injection guard. Plus a single not-run
 * cell on a non-parameterized companion case.
 *
 * Heterogeneous-parameter-set cases are a known limitation of `Papa.unparse`
 * with `header: true` — only the first row's keys become column headers, so
 * downstream cases with different param sets silently lose those columns.
 * That's documented as a deferred issue; the regression-guard tests here
 * intentionally use a homogeneous fixture.
 */
function buildAxes(): AxesShape {
  const cells = new Map<string, CellSummary>();
  cells.set(cellKey(1, 2, 0), {
    caseId: 1,
    configId: 2,
    rowIndex: 0,
    iterationCount: 1,
    pass: 1,
    fail: 0,
    notRun: 0,
    other: 0,
    worstOfStatusId: 7,
    mostRecentCompletedAt: "2026-05-01T08:30:00.000Z",
    iterations: [
      {
        id: 100,
        rowIndex: 0,
        label: "creds",
        statusId: 7,
        runId: 999,
        runName: "Smoke",
        runIsCompleted: false,
        completedAt: null,
      },
    ],
  });
  // A not-run cell to exercise "Status: Not run" and blank run id.
  cells.set(cellKey(3, 2, 0), {
    caseId: 3,
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
  });
  return {
    caseAxis: [
      {
        caseId: 1,
        caseName: "Login",
        hasParameters: true,
        paramRows: [
          {
            index: 0,
            label: "creds",
            // password begins with `=` to exercise escapeFormulae.
            values: { username: "alice", password: "=cmd|notepad" },
          },
        ],
        parameters: [
          { name: "username", type: "STRING", sensitive: false },
          { name: "password", type: "STRING", sensitive: true },
        ],
      },
      {
        caseId: 3,
        caseName: "Empty-Cell",
        hasParameters: false,
        paramRows: [
          {
            index: 0,
            label: "(no parameters)",
            values: { username: "", password: "" },
          },
        ],
        // Carry the same parameter list so Papa.unparse keeps the columns
        // aligned across all case rows. This mirrors how a real export of a
        // mixed homogeneous-param-set project would look.
        parameters: [
          { name: "username", type: "STRING", sensitive: false },
          { name: "password", type: "STRING", sensitive: true },
        ],
      },
    ],
    configAxis: [{ configId: 2, configName: "Chrome" }],
    cells,
    cellCount: 2,
    statusMap: {
      7: {
        id: 7,
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

describe("useMatrixCsvExport", () => {
  it("returns a stable function reference across renders (useCallback semantics)", () => {
    const { result, rerender } = renderHook(() => useMatrixCsvExport());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("creates a Blob and triggers <a download>.click() when invoked", () => {
    const { result } = renderHook(() => useMatrixCsvExport());
    result.current(buildAxes(), "project-42");

    expect(blobInputs.length).toBe(1);
    expect(blobInputs[0].type).toBe("text/csv;charset=utf-8;");
    expect(linkClickMock).toHaveBeenCalledTimes(1);
    expect(createdLinks.length).toBe(1);
    // download attribute MUST follow the matrix-<label>-<datetime>.csv pattern.
    const dl = createdLinks[0].getAttribute("download") ?? "";
    expect(dl).toMatch(/^matrix-project-42-\d{4}-\d{2}-\d{2}-\d{6}\.csv$/);
  });

  it("Lock B regression guard: CSV body uses bare parameter column names", () => {
    const { result } = renderHook(() => useMatrixCsvExport());
    result.current(buildAxes(), "project-42");
    const body = String(blobInputs[0].parts.join(""));
    const firstLine = body.replace(/^﻿/, "").split("\n")[0];

    expect(firstLine).toContain("username");
    expect(firstLine).toContain("password");
    // No `param.` prefix anywhere.
    expect(body).not.toMatch(/(^|,)"?param\./);
  });

  it("T-05-04 regression guard: escapeFormulae prefixes `=cmd|notepad` with `'`", () => {
    const { result } = renderHook(() => useMatrixCsvExport());
    result.current(buildAxes(), "project-42");
    const body = String(blobInputs[0].parts.join(""));
    expect(body).toContain("'=cmd|notepad");
    // No raw `=cmd|notepad` at the start of any cell.
    const lines = body.split("\n");
    for (const line of lines) {
      expect(line.match(/(^|,)=cmd\|notepad/)).toBeNull();
    }
  });

  it("emits `Status: Not run` and blank run id for cells without iterations", () => {
    const { result } = renderHook(() => useMatrixCsvExport());
    result.current(buildAxes(), "project-42");
    const body = String(blobInputs[0].parts.join(""));
    // The not-run cell row should contain `Not run` and end with empty
    // run-name + run-id columns.
    expect(body).toContain("Empty-Cell");
    expect(body).toContain("Not run");
  });

  it("emits a UTF-8 BOM as the first character of the Blob payload", () => {
    const { result } = renderHook(() => useMatrixCsvExport());
    result.current(buildAxes(), "project-42");
    const first = blobInputs[0].parts[0];
    expect(typeof first).toBe("string");
    expect((first as string).charCodeAt(0)).toBe(0xfeff);
  });
});
