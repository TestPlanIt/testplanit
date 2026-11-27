import { describe, expect, it } from "vitest";
import {
  resolveImportedResultStatus,
  type ImportStatusCandidate,
} from "./importedResultStatus";

const status = (
  id: number,
  name: string,
  systemName: string,
  flags: [isSuccess: boolean, isFailure: boolean, isCompleted: boolean],
  aliases: string | null = null
): ImportStatusCandidate => ({
  id,
  name,
  systemName,
  aliases,
  isSuccess: flags[0],
  isFailure: flags[1],
  isCompleted: flags[2],
});

// The statuses a new installation is seeded with, in their order.
const SEEDED = [
  status(1, "Untested", "untested", [false, false, false]),
  status(2, "Passed", "passed", [true, false, true], "ok,success"),
  status(3, "Failed", "failed", [false, true, true], "failure"),
  status(4, "Retest", "retest", [false, false, false]),
  status(5, "Blocked", "blocked", [false, false, false]),
  status(6, "Skipped", "skipped", [false, false, true]),
  status(7, "Exception", "exception", [false, true, true], "error"),
];

// A project whose admin replaced every seeded status with their own.
const CUSTOM = [
  status(14, "On Hold", "on_hold", [false, false, false]),
  status(11, "Green", "green", [true, false, true]),
  status(12, "Red", "red", [false, true, true]),
  status(13, "Not Applicable", "not_applicable", [false, false, true]),
];

const resolve = (
  statuses: ImportStatusCandidate[],
  result: Parameters<typeof resolveImportedResultStatus>[1]
) => resolveImportedResultStatus(statuses, result)?.id;

describe("resolveImportedResultStatus", () => {
  it("maps each result to the seeded status that carries its word", () => {
    expect(resolve(SEEDED, "passed")).toBe(2);
    expect(resolve(SEEDED, "failed")).toBe(3);
    expect(resolve(SEEDED, "error")).toBe(7);
    expect(resolve(SEEDED, "skipped")).toBe(6);
  });

  it("falls back to the status flags when no status carries the word", () => {
    expect(resolve(CUSTOM, "passed")).toBe(11);
    expect(resolve(CUSTOM, "failed")).toBe(12);
    expect(resolve(CUSTOM, "error")).toBe(12);
    expect(resolve(CUSTOM, "skipped")).toBe(13);
  });

  it("records an error as a failure when no status is set aside for errors", () => {
    const withoutException = SEEDED.filter((s) => s.id !== 7);
    expect(resolve(withoutException, "error")).toBe(3);
  });

  it("matches the display name and an alias, ignoring case", () => {
    const statuses = [
      status(21, "Skipped", "status_21", [false, false, true]),
      status(22, "Accepted", "accepted", [true, false, true], "OK, Passed"),
    ];
    expect(resolve(statuses, "skipped")).toBe(21);
    expect(resolve(statuses, "passed")).toBe(22);
  });

  it("prefers an alias that is the word over one that only contains it", () => {
    const statuses = [
      status(31, "Known Bypass", "known_bypass", [false, true, true], "bypass"),
      status(32, "Accepted", "accepted", [true, false, true], "pass"),
    ];
    expect(resolve(statuses, "passed")).toBe(32);
  });

  it("still matches an alias that only contains the word, ahead of the flags", () => {
    const statuses = [
      status(41, "Red", "red", [false, true, true]),
      status(42, "Broken Build", "broken", [false, true, true], "ci_failure"),
    ];
    expect(resolve(statuses, "failed")).toBe(42);
  });

  it("takes the first status in the given order and skips one flagged both ways", () => {
    const statuses = [
      status(51, "Mixed", "mixed", [true, true, true]),
      status(52, "Green", "green", [true, false, true]),
      status(53, "Also Green", "also_green", [true, false, true]),
    ];
    expect(resolve(statuses, "passed")).toBe(52);
    expect(resolve(statuses, "failed")).toBeUndefined();
  });

  it("returns undefined when nothing fits", () => {
    const onHoldOnly = [CUSTOM[0]];
    expect(resolve(onHoldOnly, "passed")).toBeUndefined();
    expect(resolve(onHoldOnly, "failed")).toBeUndefined();
    expect(resolve(onHoldOnly, "error")).toBeUndefined();
    expect(resolve(onHoldOnly, "skipped")).toBeUndefined();
    expect(resolve([], "passed")).toBeUndefined();
  });
});
