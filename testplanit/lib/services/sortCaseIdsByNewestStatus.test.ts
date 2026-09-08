import { describe, expect, it } from "vitest";
import { sortCaseIdsByNewestStatus } from "./latestTestResults";

type Row = Parameters<typeof sortCaseIdsByNewestStatus>[1][number];

const row = (
  test_case_id: number,
  status_order: number | null,
  executedAt = "2026-07-01T10:00:00.000Z"
): Row =>
  ({
    test_case_id,
    status_order,
    executed_at: new Date(executedAt),
  }) as Row;

describe("sortCaseIdsByNewestStatus", () => {
  it("groups cases by the status of their newest result", () => {
    const ids = [1, 2, 3, 4];
    const rows = [row(1, 30), row(2, 10), row(3, 20), row(4, 10)];

    expect(sortCaseIdsByNewestStatus(ids, rows, "asc")).toEqual([2, 4, 3, 1]);
  });

  it("reverses the grouping when descending", () => {
    const ids = [1, 2, 3];
    const rows = [row(1, 30), row(2, 10), row(3, 20)];

    expect(sortCaseIdsByNewestStatus(ids, rows, "desc")).toEqual([1, 3, 2]);
  });

  it("puts cases with no results last in both directions", () => {
    const ids = [1, 2, 3];
    const rows = [row(1, 20), row(3, 10)];

    expect(sortCaseIdsByNewestStatus(ids, rows, "asc")).toEqual([3, 1, 2]);
    expect(sortCaseIdsByNewestStatus(ids, rows, "desc")).toEqual([1, 3, 2]);
  });

  it("breaks ties within a status by most recently executed", () => {
    const ids = [1, 2, 3];
    const rows = [
      row(1, 10, "2026-01-01T00:00:00.000Z"),
      row(2, 10, "2026-07-01T00:00:00.000Z"),
      row(3, 10, "2026-03-01T00:00:00.000Z"),
    ];

    expect(sortCaseIdsByNewestStatus(ids, rows, "asc")).toEqual([2, 3, 1]);
    // Recency stays newest-first even when the status order is reversed.
    expect(sortCaseIdsByNewestStatus(ids, rows, "desc")).toEqual([2, 3, 1]);
  });

  it("sorts a status with no configured order after configured ones", () => {
    const ids = [1, 2];
    const rows = [row(1, null), row(2, 99)];

    expect(sortCaseIdsByNewestStatus(ids, rows, "asc")).toEqual([2, 1]);
  });

  it("is deterministic for cases that are entirely unexecuted", () => {
    expect(sortCaseIdsByNewestStatus([3, 1, 2], [], "asc")).toEqual([1, 2, 3]);
  });

  it("does not mutate the input", () => {
    const ids = [3, 1, 2];
    sortCaseIdsByNewestStatus(ids, [row(1, 10)], "asc");

    expect(ids).toEqual([3, 1, 2]);
  });
});
