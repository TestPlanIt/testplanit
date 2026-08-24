import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  baseDb: {
    $queryRaw: vi.fn(),
    status: { findMany: vi.fn() },
  },
}));

import { baseDb } from "~/lib/db";
import {
  getEffectiveCaseCompletion,
  getEffectiveRunCaseStatuses,
  getMilestoneCaseCompletion,
} from "./effectiveCaseStatus";

const mockQueryRaw = baseDb.$queryRaw as unknown as ReturnType<typeof vi.fn>;
const mockStatusFindMany = baseDb.status.findMany as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  mockQueryRaw.mockReset();
  mockStatusFindMany.mockReset();
});

describe("getMilestoneCaseCompletion", () => {
  it("skips the query entirely for an empty scope", async () => {
    const counts = await getMilestoneCaseCompletion([]);

    expect(counts.size).toBe(0);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("maps per-milestone rows and coerces bigints", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { milestoneId: 485, total: BigInt(10), completed: BigInt(4) },
      { milestoneId: 594, total: BigInt(3), completed: BigInt(3) },
    ]);

    const counts = await getMilestoneCaseCompletion([485, 594]);

    expect(counts.get(485)).toEqual({ total: 10, completed: 4 });
    expect(counts.get(594)).toEqual({ total: 3, completed: 3 });
  });
});

describe("getEffectiveCaseCompletion", () => {
  it("sums per-milestone counts for a milestone scope", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { milestoneId: 485, total: BigInt(10), completed: BigInt(2) },
      { milestoneId: 594, total: BigInt(90), completed: BigInt(88) },
    ]);

    const counts = await getEffectiveCaseCompletion({
      milestoneIds: [485, 594],
    });

    expect(counts).toEqual({ total: 100, completed: 90 });
  });

  it("skips the query entirely for an empty run scope", async () => {
    const counts = await getEffectiveCaseCompletion({ runIds: [] });

    expect(counts).toEqual({ total: 0, completed: 0 });
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("returns the combined row for a run scope", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { total: BigInt(7), completed: BigInt(5) },
    ]);

    const counts = await getEffectiveCaseCompletion({ runIds: [1, 2] });

    expect(counts).toEqual({ total: 7, completed: 5 });
  });
});

describe("getEffectiveRunCaseStatuses", () => {
  it("skips the query entirely for an empty id list", async () => {
    const resolved = await getEffectiveRunCaseStatuses([]);

    expect(resolved.size).toBe(0);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("resolves each run-case to its effective status with color", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { testRunCaseId: 11, statusId: 2 },
      { testRunCaseId: 12, statusId: 2 },
      { testRunCaseId: 13, statusId: 3 },
    ]);
    mockStatusFindMany.mockResolvedValueOnce([
      { id: 2, name: "Passed", isCompleted: true, color: { value: "#0f0" } },
      { id: 3, name: "Failed", isCompleted: true, color: { value: "#f00" } },
    ]);

    const resolved = await getEffectiveRunCaseStatuses([11, 12, 13, 14]);

    expect(resolved.get(11)).toMatchObject({ id: 2, name: "Passed" });
    expect(resolved.get(12)).toMatchObject({ id: 2, name: "Passed" });
    expect(resolved.get(13)).toMatchObject({ id: 3, name: "Failed" });
    // 14 had no status-carrying view row — absent, never null-filled.
    expect(resolved.has(14)).toBe(false);
    // Statuses are fetched once, deduplicated.
    expect(mockStatusFindMany).toHaveBeenCalledTimes(1);
    expect(mockStatusFindMany.mock.calls[0][0].where.id.in).toEqual([2, 3]);
  });

  it("does not fetch statuses when nothing resolved", async () => {
    mockQueryRaw.mockResolvedValueOnce([]);

    const resolved = await getEffectiveRunCaseStatuses([99]);

    expect(resolved.size).toBe(0);
    expect(mockStatusFindMany).not.toHaveBeenCalled();
  });
});
