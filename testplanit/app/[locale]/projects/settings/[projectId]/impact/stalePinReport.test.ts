import { describe, expect, it } from "vitest";
import { isStalePinCheckInFlight, readStalePinReport } from "./stalePinReport";

describe("readStalePinReport", () => {
  it("treats missing or malformed values as never checked", () => {
    expect(readStalePinReport(null)).toEqual({ kind: "never" });
    expect(readStalePinReport("x")).toEqual({ kind: "never" });
    expect(readStalePinReport([])).toEqual({ kind: "never" });
    expect(readStalePinReport({ stale: 3 })).toEqual({ kind: "never" });
  });

  it("reads a running check's progress, defaulting counts to zero", () => {
    expect(
      readStalePinReport({
        running: true,
        startedAt: "2026-09-18T00:00:00Z",
        checkedFiles: 4,
      })
    ).toEqual({
      kind: "running",
      unresponsive: false,
      progress: {
        startedAt: "2026-09-18T00:00:00Z",
        progressAt: null,
        checkedFiles: 4,
        totalFiles: 0,
        pins: 0,
      },
    });
  });

  it("surfaces a failed check with its error", () => {
    expect(
      readStalePinReport({ error: "boom", checkedAt: "2026-09-18T00:00:00Z" })
    ).toEqual({
      kind: "error",
      error: "boom",
      checkedAt: "2026-09-18T00:00:00Z",
    });
  });

  it("normalizes a completed report", () => {
    expect(
      readStalePinReport({
        checkedAt: "2026-09-18T00:00:00Z",
        checkedSha: "abc",
        pins: 10,
        checked: 9,
        stale: 2,
        unreadableFiles: 1,
        byReason: { FILE_DELETED: 2 },
      })
    ).toEqual({
      kind: "checked",
      report: {
        checkedAt: "2026-09-18T00:00:00Z",
        checkedSha: "abc",
        pins: 10,
        checked: 9,
        stale: 2,
        dismissed: 0,
        managed: 0,
        unreadableFiles: 1,
        byReason: {
          FILE_DELETED: 2,
          SNIPPET_NOT_FOUND: 0,
          SYMBOL_NOT_FOUND: 0,
        },
      },
    });
  });
});

describe("queue-backed states", () => {
  it("reports a queued check with what the worker is busy with", () => {
    expect(
      readStalePinReport({
        queued: true,
        requestedAt: "2026-09-28T10:00:00Z",
        behind: { kind: "scan-issues", configId: 4 },
      })
    ).toEqual({
      kind: "queued",
      queued: {
        requestedAt: "2026-09-28T10:00:00Z",
        behind: { kind: "scan-issues", configId: 4 },
      },
    });
  });

  it("carries the resolver's not-responding verdict on a running check", () => {
    expect(
      readStalePinReport({ running: true, unresponsive: true })
    ).toMatchObject({ kind: "running", unresponsive: true });
  });

  it("reports a check the queue lost as interrupted, and a stopped one as cancelled", () => {
    expect(
      readStalePinReport({
        interrupted: true,
        startedAt: "2026-09-28T04:00:00Z",
        checkedAt: "2026-09-28T10:00:00Z",
      })
    ).toEqual({
      kind: "interrupted",
      startedAt: "2026-09-28T04:00:00Z",
      checkedAt: "2026-09-28T10:00:00Z",
    });
    expect(
      readStalePinReport({ cancelled: true, checkedAt: "2026-09-28T10:00:00Z" })
    ).toEqual({ kind: "cancelled", checkedAt: "2026-09-28T10:00:00Z" });
  });

  it("counts queued and running as in flight, nothing else", () => {
    expect(isStalePinCheckInFlight(readStalePinReport({ queued: true }))).toBe(
      true
    );
    expect(isStalePinCheckInFlight(readStalePinReport({ running: true }))).toBe(
      true
    );
    expect(
      isStalePinCheckInFlight(readStalePinReport({ interrupted: true }))
    ).toBe(false);
  });
});
