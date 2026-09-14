import { describe, expect, it } from "vitest";
import {
  ISSUE_SCAN_STALE_MS,
  isIssueScanStale,
  readIssueScanReport,
} from "./issueScanReport";

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
      namingCountsKnown: false,
      report: {
        scannedCommits: 120,
        cachedCommits: 0,
        commitsNamingTickets: 0,
        namedTickets: 0,
        matchedCommits: 4,
        skippedLargeCommits: 0,
        issues: 0,
        created: 6,
        updated: 0,
        removed: 0,
        unchanged: 0,
        fetchCapped: true,
        truncated: false,
        full: false,
        importedIssues: 0,
        importFailures: 0,
        importSkipped: 0,
        importMoved: 0,
        createdSymbolPins: 0,
        importFailureDetails: [],
        scannedAt: "2026-09-12T00:00:00Z",
      },
    });
  });

  it("knows when the naming counters were written", () => {
    expect(
      readIssueScanReport({ scannedAt: "2026-09-13T00:00:00Z" })
    ).toMatchObject({ namingCountsKnown: false });
    expect(
      readIssueScanReport({
        scannedAt: "2026-09-13T00:00:00Z",
        commitsNamingTickets: 3,
        namedTickets: 5,
      })
    ).toMatchObject({ namingCountsKnown: true });
  });

  it("keeps well-formed import failure details and drops the rest", () => {
    const view = readIssueScanReport({
      scannedAt: "2026-09-13T00:00:00Z",
      importFailures: 3,
      importFailureDetails: [
        { key: "ABT-1", error: "tracked by project 364" },
        { key: 7 },
        "junk",
      ],
    });
    expect(view).toMatchObject({
      kind: "scanned",
      report: {
        importFailureDetails: [
          { key: "ABT-1", error: "tracked by project 364" },
        ],
      },
    });
  });

  it("keeps the full-history flag and the import counts", () => {
    const view = readIssueScanReport({
      scannedCommits: 9000,
      full: true,
      importedIssues: 12,
      importFailures: 3,
      scannedAt: "2026-09-13T00:00:00Z",
    });
    expect(view).toMatchObject({
      kind: "scanned",
      report: { full: true, importedIssues: 12, importFailures: 3 },
    });
  });

  it("reports a scan in progress with its counts", () => {
    const view = readIssueScanReport({
      running: true,
      full: true,
      stage: "import",
      startedAt: "2026-09-13T00:00:00Z",
      progressAt: "2026-09-13T00:05:00Z",
      scannedCommits: 400,
      matchedCommits: 30,
      fetchedCommits: 25,
      importLookups: 40,
      importedIssues: 12,
    });
    expect(view).toEqual({
      kind: "running",
      progress: {
        full: true,
        stage: "import",
        startedAt: "2026-09-13T00:00:00Z",
        progressAt: "2026-09-13T00:05:00Z",
        scannedCommits: 400,
        cachedCommits: 0,
        matchedCommits: 30,
        fetchedCommits: 25,
        importLookups: 40,
        importedIssues: 12,
      },
    });
  });

  it("reports a cancelled scan", () => {
    expect(
      readIssueScanReport({
        cancelled: true,
        full: true,
        scannedAt: "2026-09-13T00:00:00Z",
      })
    ).toEqual({
      kind: "cancelled",
      full: true,
      scannedAt: "2026-09-13T00:00:00Z",
    });
  });

  it("defaults an unknown stage to the walk", () => {
    const view = readIssueScanReport({ running: true, stage: "bogus" });
    expect(view).toMatchObject({
      kind: "running",
      progress: { stage: "walk" },
    });
  });

  describe("isIssueScanStale", () => {
    const now = Date.parse("2026-09-13T12:00:00Z");
    const progress = (
      startedAt: string | null,
      progressAt: string | null = null
    ) => ({
      full: false,
      stage: "walk" as const,
      startedAt,
      progressAt,
      scannedCommits: 0,
      cachedCommits: 0,
      matchedCommits: 0,
      fetchedCommits: 0,
      importLookups: 0,
      importedIssues: 0,
    });

    it("trusts a flag younger than the cutoff", () => {
      expect(isIssueScanStale(progress("2026-09-13T11:50:00Z"), now)).toBe(
        false
      );
    });

    it("treats a flag older than the cutoff as abandoned", () => {
      const old = new Date(now - ISSUE_SCAN_STALE_MS - 1).toISOString();
      expect(isIssueScanStale(progress(old), now)).toBe(true);
    });

    it("judges by the last progress write when there is one", () => {
      const oldStart = new Date(now - 3 * ISSUE_SCAN_STALE_MS).toISOString();
      expect(
        isIssueScanStale(progress(oldStart, "2026-09-13T11:55:00Z"), now)
      ).toBe(false);
    });

    it("treats a flag with no usable start time as abandoned", () => {
      expect(isIssueScanStale(progress(null), now)).toBe(true);
      expect(isIssueScanStale(progress("not a date"), now)).toBe(true);
    });
  });
});
