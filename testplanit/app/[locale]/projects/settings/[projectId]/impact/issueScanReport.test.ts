import { describe, expect, it } from "vitest";
import { readIssueScanReport } from "./issueScanReport";

describe("readIssueScanReport", () => {
  it("treats missing or malformed values as never scanned", () => {
    expect(readIssueScanReport(null)).toEqual({ kind: "never" });
    expect(readIssueScanReport("x")).toEqual({ kind: "never" });
    expect(readIssueScanReport([])).toEqual({ kind: "never" });
    expect(readIssueScanReport({ created: 3 })).toEqual({ kind: "never" });
  });

  it("surfaces a failed scan with its error", () => {
    expect(
      readIssueScanReport({ error: "boom", scannedAt: "2026-09-12T00:00:00Z" })
    ).toEqual({
      kind: "error",
      error: "boom",
      scannedAt: "2026-09-12T00:00:00Z",
    });
  });

  it("normalizes a completed report, defaulting absent counts to zero", () => {
    const view = readIssueScanReport({
      scannedCommits: 120,
      matchedCommits: 4,
      created: 6,
      fetchCapped: true,
      scannedAt: "2026-09-12T00:00:00Z",
    });
    expect(view).toEqual({
      kind: "scanned",
      report: {
        scannedCommits: 120,
        matchedCommits: 4,
        skippedLargeCommits: 0,
        issues: 0,
        created: 6,
        updated: 0,
        removed: 0,
        unchanged: 0,
        fetchCapped: true,
        truncated: false,
        scannedAt: "2026-09-12T00:00:00Z",
      },
    });
  });
});
