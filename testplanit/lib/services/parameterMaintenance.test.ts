import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

import { updateHasParameters } from "./parameterMaintenance";

/**
 * Builds a minimal Prisma.TransactionClient mock that exposes only the two
 * methods the helper is contracted to call: testCaseParameter.count and
 * repositoryCases.update.
 */
function createMockTx(countReturn: number) {
  const count = vi.fn().mockResolvedValue(countReturn);
  const update = vi.fn().mockResolvedValue(undefined);
  return {
    tx: {
      testCaseParameter: { count },
      repositoryCases: { update },
    } as unknown as Prisma.TransactionClient,
    count,
    update,
  };
}

describe("updateHasParameters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets hasParameters to true when the case has 2 non-soft-deleted parameters", async () => {
    const { tx, update } = createMockTx(2);

    await updateHasParameters(42, tx);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { hasParameters: true },
    });
  });

  it("sets hasParameters to false when the case has 0 non-soft-deleted parameters", async () => {
    const { tx, update } = createMockTx(0);

    await updateHasParameters(42, tx);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { hasParameters: false },
    });
  });

  it("treats count=1 (one live param + soft-deleted siblings) as hasParameters=true", async () => {
    // Soft-deleted siblings are not counted because the where clause filters
    // isDeleted: false. The mock returns the count the DB *would* return.
    const { tx, update } = createMockTx(1);

    await updateHasParameters(7, tx);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { hasParameters: true },
    });
  });

  it("treats count=0 (only soft-deleted params) as hasParameters=false", async () => {
    // 5 soft-deleted, 0 live → DB count returns 0 → flag clears.
    const { tx, update } = createMockTx(0);

    await updateHasParameters(99, tx);

    expect(update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { hasParameters: false },
    });
  });

  it("filters the count by testCaseId AND isDeleted: false (soft-delete invariant)", async () => {
    const { tx, count } = createMockTx(3);

    await updateHasParameters(123, tx);

    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith({
      where: { testCaseId: 123, isDeleted: false },
    });
  });

  it("targets the RepositoryCases row by id (using caseId, not parameter id)", async () => {
    const { tx, update } = createMockTx(0);

    await updateHasParameters(555, tx);

    expect(update).toHaveBeenCalledWith({
      where: { id: 555 },
      data: { hasParameters: false },
    });
  });

  it("is idempotent — calling twice with the same count produces identical update calls", async () => {
    const { tx, update } = createMockTx(2);

    await updateHasParameters(10, tx);
    await updateHasParameters(10, tx);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0]).toEqual(update.mock.calls[1]);
  });
});
