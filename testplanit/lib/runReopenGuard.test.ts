import { ORMError } from "@zenstackhq/orm";
import { describe, expect, it, vi } from "vitest";
import {
  assertRunNotReopened,
  type CompletedRunReader,
} from "./runReopenGuard";

const reader = (completed: { id: number } | null) => {
  const findFirst = vi.fn(async () => completed);
  return {
    findFirst,
    reader: { testRuns: { findFirst } } as unknown as CompletedRunReader,
  };
};

describe("assertRunNotReopened", () => {
  it("rejects clearing isCompleted on a completed run", async () => {
    const { reader: r, findFirst } = reader({ id: 7 });
    const attempt = assertRunNotReopened(
      "TestRuns",
      "update",
      { where: { id: 7 }, data: { isCompleted: false, completedAt: null } },
      r
    );

    await expect(attempt).rejects.toBeInstanceOf(ORMError);
    await expect(attempt).rejects.toThrow(/cannot be reopened/);
    expect(findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: 7 }, { isCompleted: true }] },
      select: { id: true },
    });
  });

  it("checks the update branch of an upsert and every row of updateMany", async () => {
    await expect(
      assertRunNotReopened(
        "TestRuns",
        "upsert",
        {
          where: { id: 7 },
          create: { isCompleted: false },
          update: { isCompleted: false },
        },
        reader({ id: 7 }).reader
      )
    ).rejects.toThrow(/cannot be reopened/);
    await expect(
      assertRunNotReopened(
        "TestRuns",
        "updateMany",
        { where: { projectId: 3 }, data: { isCompleted: false } },
        reader({ id: 9 }).reader
      )
    ).rejects.toThrow(/Test run 9/);
  });

  it("allows clearing isCompleted on a run that is still open", async () => {
    await expect(
      assertRunNotReopened(
        "TestRuns",
        "update",
        { where: { id: 7 }, data: { isCompleted: false } },
        reader(null).reader
      )
    ).resolves.toBeUndefined();
  });

  it("ignores writes that leave isCompleted alone or complete the run", async () => {
    const { reader: r, findFirst } = reader({ id: 7 });
    for (const data of [{ name: "Renamed" }, { isCompleted: true }]) {
      await assertRunNotReopened(
        "TestRuns",
        "update",
        { where: { id: 7 }, data },
        r
      );
    }
    await assertRunNotReopened(
      "TestRuns",
      "create",
      { data: { isCompleted: false } },
      r
    );
    await assertRunNotReopened(
      "Sessions",
      "update",
      { where: { id: 7 }, data: { isCompleted: false } },
      r
    );

    expect(findFirst).not.toHaveBeenCalled();
  });
});
