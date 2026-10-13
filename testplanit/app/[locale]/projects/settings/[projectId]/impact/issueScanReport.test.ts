import { describe, expect, it } from "vitest";
import {
  isIssueScanInFlight,
  readIssueScanReport,
  readJobBehind,
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
      unresponsive: false,
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

  it("carries the resolver's not-responding verdict on a running scan", () => {
    expect(
      readIssueScanReport({ running: true, unresponsive: true })
    ).toMatchObject({ kind: "running", unresponsive: true });
  });

  it("reports a queued scan with what the worker is busy with", () => {
    expect(
      readIssueScanReport({
        queued: true,
        full: true,
        requestedAt: "2026-09-28T10:00:00Z",
        behind: { kind: "sweep", configId: 4 },
      })
    ).toEqual({
      kind: "queued",
      queued: {
        full: true,
        requestedAt: "2026-09-28T10:00:00Z",
        behind: { kind: "sweep", configId: 4 },
      },
    });
    expect(readIssueScanReport({ queued: true })).toEqual({
      kind: "queued",
      queued: { full: false, requestedAt: null, behind: null },
    });
  });

  it("reports a scan the queue lost as interrupted", () => {
    expect(
      readIssueScanReport({
        interrupted: true,
        full: true,
        startedAt: "2026-09-28T04:00:00Z",
        scannedAt: "2026-09-28T10:00:00Z",
      })
    ).toEqual({
      kind: "interrupted",
      full: true,
      startedAt: "2026-09-28T04:00:00Z",
      scannedAt: "2026-09-28T10:00:00Z",
    });
  });

  it("counts queued and running as in flight, nothing else", () => {
    expect(isIssueScanInFlight(readIssueScanReport({ queued: true }))).toBe(
      true
    );
    expect(isIssueScanInFlight(readIssueScanReport({ running: true }))).toBe(
      true
    );
    expect(
      isIssueScanInFlight(readIssueScanReport({ interrupted: true }))
    ).toBe(false);
    expect(
      isIssueScanInFlight(
        readIssueScanReport({ scannedAt: "2026-09-13T00:00:00Z" })
      )
    ).toBe(false);
  });

  it("reads only a well-formed behind", () => {
    expect(readJobBehind({ kind: "refresh-cache", configId: 9 })).toEqual({
      kind: "refresh-cache",
      configId: 9,
    });
    expect(readJobBehind({ kind: "other" })).toEqual({
      kind: "other",
      configId: null,
    });
    expect(readJobBehind({ kind: "bogus" })).toBeNull();
    expect(readJobBehind("sweep")).toBeNull();
  });
});
