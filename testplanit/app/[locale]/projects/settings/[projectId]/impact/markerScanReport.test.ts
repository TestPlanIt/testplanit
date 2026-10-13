import { describe, expect, it } from "vitest";
import {
  MARKER_PROBLEM_PREVIEW_LIMIT,
  readMarkerScanReport,
} from "./markerScanReport";

const fullReport = {
  scannedFiles: 120,
  skippedFiles: 3,
  annotationMarkers: 7,
  mapEntries: 2,
  created: 4,
  updated: 3,
  removed: 1,
  unchanged: 1,
  problems: [
    { kind: "unknown_case", detail: "src/a.ts:12 case 999 not found" },
    { kind: "yaml_error", detail: ".testplanit/testmap.yml: bad indent" },
  ],
  problemCount: 2,
  anchorSha: "abc123",
  scannedAt: "2026-09-03T10:00:00.000Z",
};

describe("readMarkerScanReport", () => {
  it("treats null, undefined, primitives and arrays as never scanned", () => {
    expect(readMarkerScanReport(null)).toEqual({ kind: "never" });
    expect(readMarkerScanReport(undefined)).toEqual({ kind: "never" });
    expect(readMarkerScanReport("nope")).toEqual({ kind: "never" });
    expect(readMarkerScanReport([1, 2])).toEqual({ kind: "never" });
    expect(readMarkerScanReport({})).toEqual({ kind: "never" });
  });

  it("classifies the two skip reasons and rejects unknown ones", () => {
    expect(
      readMarkerScanReport({ skipped: "privacy_mode", scannedAt: "t" })
    ).toEqual({ kind: "skipped", reason: "privacy_mode", scannedAt: "t" });
    expect(readMarkerScanReport({ skipped: "partial_contents" })).toEqual({
      kind: "skipped",
      reason: "partial_contents",
      scannedAt: null,
    });
    expect(readMarkerScanReport({ skipped: "something_else" })).toEqual({
      kind: "never",
    });
  });

  it("surfaces a failed scan with its message", () => {
    expect(
      readMarkerScanReport({ error: "rate limited", scannedAt: "t" })
    ).toEqual({ kind: "error", error: "rate limited", scannedAt: "t" });
  });

  it("passes a full report through with the first problem details", () => {
    const view = readMarkerScanReport(fullReport);
    expect(view.kind).toBe("scanned");
    if (view.kind !== "scanned") return;
    expect(view.report).toEqual(fullReport);
    expect(view.problemDetails).toEqual([
      "src/a.ts:12 case 999 not found",
      ".testplanit/testmap.yml: bad indent",
    ]);
  });

  it("caps the problem preview and falls back to the array length for the count", () => {
    const problems = Array.from({ length: 12 }, (_, i) => ({
      kind: "invalid_entry",
      detail: `problem ${i}`,
    }));
    const view = readMarkerScanReport({
      ...fullReport,
      problems,
      problemCount: undefined,
    });
    expect(view.kind).toBe("scanned");
    if (view.kind !== "scanned") return;
    expect(view.report.problemCount).toBe(12);
    expect(view.problemDetails).toHaveLength(MARKER_PROBLEM_PREVIEW_LIMIT);
    expect(view.problemDetails[0]).toBe("problem 0");
  });

  it("defaults missing or malformed counters to zero and drops malformed problems", () => {
    const view = readMarkerScanReport({
      scannedAt: "t",
      annotationMarkers: "seven",
      problems: [{ kind: "unknown_case" }, "text", { detail: "kept" }],
    });
    expect(view.kind).toBe("scanned");
    if (view.kind !== "scanned") return;
    expect(view.report.annotationMarkers).toBe(0);
    expect(view.report.created).toBe(0);
    expect(view.report.problems).toEqual([{ kind: undefined, detail: "kept" }]);
    expect(view.report.problemCount).toBe(1);
    expect(view.report.anchorSha).toBe("");
  });
});
