import { describe, expect, it } from "vitest";
import { ISSUE_SCAN_STALE_MS } from "./issueScanReport";
import { isStalePinCheckAbandoned, readStalePinReport } from "./stalePinReport";

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

describe("isStalePinCheckAbandoned", () => {
  const base = { checkedFiles: 0, totalFiles: 0, pins: 0 };
  const now = Date.parse("2026-09-18T12:00:00Z");

  it("judges by the last progress write, falling back to the start", () => {
    const fresh = new Date(now - 1000).toISOString();
    const old = new Date(now - ISSUE_SCAN_STALE_MS - 1).toISOString();
    expect(
      isStalePinCheckAbandoned(
        { ...base, startedAt: old, progressAt: fresh },
        now
      )
    ).toBe(false);
    expect(
      isStalePinCheckAbandoned(
        { ...base, startedAt: fresh, progressAt: old },
        now
      )
    ).toBe(true);
    expect(
      isStalePinCheckAbandoned(
        { ...base, startedAt: fresh, progressAt: null },
        now
      )
    ).toBe(false);
  });

  it("treats a missing or unparsable timestamp as abandoned", () => {
    expect(
      isStalePinCheckAbandoned(
        { ...base, startedAt: null, progressAt: null },
        now
      )
    ).toBe(true);
    expect(
      isStalePinCheckAbandoned(
        { ...base, startedAt: "nope", progressAt: null },
        now
      )
    ).toBe(true);
  });
});
