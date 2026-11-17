import { describe, expect, it, vi } from "vitest";
import {
  prepareRunCaseRestore,
  RUN_CASE_RESTORE_RESET,
  type RunCaseRestoreClient,
} from "./runCaseRestoreReset";

// Run 7: case 100 (row 1, live), case 101 (row 2, removed), case 102 (row 3, removed)
const ROWS = [
  { id: 1, testRunId: 7, repositoryCaseId: 100, isDeleted: false },
  { id: 2, testRunId: 7, repositoryCaseId: 101, isDeleted: true },
  { id: 3, testRunId: 7, repositoryCaseId: 102, isDeleted: true },
];

function matches(row: (typeof ROWS)[number], where: any): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    const actual = (row as any)[key];
    if (key === "AND") {
      if (!(value as any[]).every((w) => matches(row, w))) return false;
    } else if (key === "OR") {
      if (!(value as any[]).some((w) => matches(row, w))) return false;
    } else if (value && typeof value === "object" && "in" in (value as any)) {
      if (!(value as any).in.includes(actual)) return false;
    } else if (key === "testRunId_repositoryCaseId") {
      const k = value as any;
      if (
        row.testRunId !== k.testRunId ||
        row.repositoryCaseId !== k.repositoryCaseId
      )
        return false;
    } else if (actual !== value) return false;
  }
  return true;
}

const client = () => {
  const iterations = vi.fn(async () => ({ count: 0 }));
  return {
    client: {
      testRunCases: {
        findMany: vi.fn(async ({ where }: any) =>
          ROWS.filter((r) => matches(r, where)).map(
            ({ id, repositoryCaseId }) => ({ id, repositoryCaseId })
          )
        ),
      },
      testRunCaseIteration: { updateMany: iterations },
    } as unknown as RunCaseRestoreClient,
    iterations,
  };
};

describe("prepareRunCaseRestore", () => {
  it("resets a removed row that a single update restores, then restores its iterations", async () => {
    const { client: c, iterations } = client();
    const args = { where: { id: 2 }, data: { isDeleted: false, order: 9 } };
    const after = await prepareRunCaseRestore(
      "TestRunCases",
      "update",
      args,
      c
    );
    expect(args.data).toEqual({
      isDeleted: false,
      order: 9,
      ...RUN_CASE_RESTORE_RESET,
    });
    await after!();
    expect(iterations).toHaveBeenCalledWith({
      where: { testRunCaseId: { in: [2] }, isDeleted: true },
      data: expect.objectContaining({ isDeleted: false, statusId: null }),
    });
  });

  it("leaves a live row's progress alone", async () => {
    const { client: c } = client();
    const args = { where: { id: 1 }, data: { isDeleted: false } };
    expect(
      await prepareRunCaseRestore("TestRunCases", "update", args, c)
    ).toBeNull();
    expect(args.data).toEqual({ isDeleted: false });
  });

  it("resets an updateMany only when every targeted row is removed", async () => {
    const { client: c } = client();
    const all = { where: { id: { in: [2, 3] } }, data: { isDeleted: false } };
    const after = await prepareRunCaseRestore(
      "TestRunCases",
      "updateMany",
      all,
      c
    );
    expect(all.data).toMatchObject(RUN_CASE_RESTORE_RESET);
    expect(after).not.toBeNull();

    const mixed = { where: { id: { in: [1, 2] } }, data: { isDeleted: false } };
    await prepareRunCaseRestore("TestRunCases", "updateMany", mixed, c);
    expect(mixed.data).toEqual({ isDeleted: false });
  });

  it("resets the restoring entries of a run's nested upsert (the run page's save)", async () => {
    const { client: c, iterations } = client();
    const entry = (repositoryCaseId: number) => ({
      where: { testRunId_repositoryCaseId: { testRunId: 7, repositoryCaseId } },
      create: {
        repositoryCase: { connect: { id: repositoryCaseId } },
        order: 1,
      },
      update: { isDeleted: false, order: 1 },
    });
    const args = {
      where: { id: 7 },
      data: { testCases: { upsert: [entry(100), entry(101), entry(103)] } },
    };
    const after = await prepareRunCaseRestore("TestRuns", "update", args, c);
    const [live, removed, fresh] = args.data.testCases.upsert;
    expect(live.update).toEqual({ isDeleted: false, order: 1 });
    expect(removed.update).toEqual({
      isDeleted: false,
      order: 1,
      ...RUN_CASE_RESTORE_RESET,
    });
    expect(fresh.update).toEqual({ isDeleted: false, order: 1 });
    await after!();
    expect(iterations).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { testRunCaseId: { in: [2] }, isDeleted: true },
      })
    );
  });

  it("ignores writes that do not restore anything", async () => {
    const { client: c } = client();
    expect(
      await prepareRunCaseRestore(
        "TestRunCases",
        "update",
        { where: { id: 2 }, data: { order: 3 } },
        c
      )
    ).toBeNull();
    expect(
      await prepareRunCaseRestore(
        "TestRunCases",
        "create",
        { data: { testRunId: 7, repositoryCaseId: 5 } },
        c
      )
    ).toBeNull();
    expect((c.testRunCases.findMany as any).mock.calls.length).toBe(0);
  });
});
