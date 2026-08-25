// Wave 0 scaffold, owner 27-05. Proves D-03/D-04/D-05 (CONTEXT.md): a
// case<->requirement linkage is suspect iff the case HAS a latest
// execution AND contentUpdatedAt > executed_at AND (suspectDismissedAt IS
// NULL OR contentUpdatedAt > suspectDismissedAt). `executed_at` comes from
// the shared latestCaseResultsCte() union of manual + JUnit results — this
// predicate never re-derives "latest execution" itself.

import { describe, expect, it } from "vitest";

import { isLinkageSuspect } from "./suspectLinkage";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const T1 = new Date("2026-01-02T00:00:00.000Z");
const T2 = new Date("2026-01-03T00:00:00.000Z");

describe("isLinkageSuspect", () => {
  it("returns false when the case has never been executed", () => {
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T1,
        lastExecutedAt: null,
        suspectDismissedAt: null,
      })
    ).toBe(false);
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T1,
        lastExecutedAt: undefined,
        suspectDismissedAt: null,
      })
    ).toBe(false);
  });

  it("returns false when the requirement has never had a content edit", () => {
    expect(
      isLinkageSuspect({
        contentUpdatedAt: null,
        lastExecutedAt: T0,
        suspectDismissedAt: null,
      })
    ).toBe(false);
    expect(
      isLinkageSuspect({
        contentUpdatedAt: undefined,
        lastExecutedAt: T0,
        suspectDismissedAt: null,
      })
    ).toBe(false);
  });

  it("returns true when contentUpdatedAt is newer than the case's last execution", () => {
    // Date inputs.
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T1,
        lastExecutedAt: T0,
        suspectDismissedAt: null,
      })
    ).toBe(true);
    // ISO-string inputs must agree with the Date-input result above for the
    // same table row.
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T1.toISOString(),
        lastExecutedAt: T0.toISOString(),
        suspectDismissedAt: null,
      })
    ).toBe(true);
  });

  it("returns false when the case was re-executed after the content edit", () => {
    // Strictly newer execution.
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T0,
        lastExecutedAt: T1,
        suspectDismissedAt: null,
      })
    ).toBe(false);
    // Equal timestamps — proves strict `>` rather than `>=` on the
    // content-vs-execution comparison.
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T0,
        lastExecutedAt: T0,
        suspectDismissedAt: null,
      })
    ).toBe(false);
  });

  it("returns false when the flag was dismissed after the content edit", () => {
    // Dismissal strictly after the content edit.
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T1,
        lastExecutedAt: T0,
        suspectDismissedAt: T2,
      })
    ).toBe(false);
    // Equal timestamps — proves strict `>` rather than `>=` on the
    // content-vs-dismissal comparison.
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T1,
        lastExecutedAt: T0,
        suspectDismissedAt: T1,
      })
    ).toBe(false);
  });

  it("returns true again when a newer content edit follows a dismissal", () => {
    // Date inputs: dismissed at T1, then a newer edit at T2.
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T2,
        lastExecutedAt: T0,
        suspectDismissedAt: T1,
      })
    ).toBe(true);
    // ISO-string inputs must agree with the Date-input result above.
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T2.toISOString(),
        lastExecutedAt: T0.toISOString(),
        suspectDismissedAt: T1.toISOString(),
      })
    ).toBe(true);
  });

  it("returns false for an unparseable timestamp rather than throwing", () => {
    expect(() =>
      isLinkageSuspect({
        contentUpdatedAt: "not-a-real-timestamp",
        lastExecutedAt: T0,
        suspectDismissedAt: null,
      })
    ).not.toThrow();
    expect(
      isLinkageSuspect({
        contentUpdatedAt: "not-a-real-timestamp",
        lastExecutedAt: T0,
        suspectDismissedAt: null,
      })
    ).toBe(false);
    expect(
      isLinkageSuspect({
        contentUpdatedAt: T1,
        lastExecutedAt: "also-not-a-real-timestamp",
        suspectDismissedAt: null,
      })
    ).toBe(false);
  });
});
