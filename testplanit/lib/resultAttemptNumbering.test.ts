import { describe, expect, it, vi } from "vitest";
import {
  assignResultAttempts,
  type AttemptReader,
} from "./resultAttemptNumbering";

const EXISTING: Record<string, number[]> = {
  "50:": [1, 2, 3], // run case 50, no iteration: attempts 1-3 (one of them removed)
  "50:7": [1], // iteration 7 of run case 50
};

const reader = () =>
  ({
    testRunResults: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { testRunCaseId: number; iterationId: number | null };
        }) =>
          (
            EXISTING[`${where.testRunCaseId}:${where.iterationId ?? ""}`] ?? []
          ).map((attempt) => ({ attempt }))
      ),
    },
  }) as unknown as AttemptReader;

const create = async (data: Record<string, unknown>) => {
  const args = { data };
  await assignResultAttempts("TestRunResults", "create", args, reader());
  return args.data;
};

describe("assignResultAttempts", () => {
  it("numbers a result that carries no attempt after the highest existing one", async () => {
    const data = await create({ testRunCaseId: 50, statusId: 1 });
    expect(data.attempt).toBe(4);
  });

  it("replaces an attempt an existing result already carries", async () => {
    // The quick status buttons send 1; the MCP counted live rows and would
    // send 3 again after a removal.
    expect((await create({ testRunCaseId: 50, attempt: 1 })).attempt).toBe(4);
    expect((await create({ testRunCaseId: 50, attempt: 3 })).attempt).toBe(4);
  });

  it("keeps a free attempt the client chose", async () => {
    expect((await create({ testRunCaseId: 50, attempt: 9 })).attempt).toBe(9);
  });

  it("numbers per iteration, through relation connects too", async () => {
    const data = await create({
      testRunCase: { connect: { id: 50 } },
      iteration: { connect: { id: 7 } },
    });
    expect(data.attempt).toBe(2);
  });

  it("starts at 1 for a run case with no results", async () => {
    expect((await create({ testRunCaseId: 60 })).attempt).toBe(1);
  });

  it("numbers every row of a createMany batch without reusing a number", async () => {
    const args = {
      data: [
        { testRunCaseId: 60, statusId: 1 },
        { testRunCaseId: 60, statusId: 2, attempt: 1 },
        { testRunCaseId: 50, statusId: 1 },
      ],
    };
    const r = reader();
    await assignResultAttempts("TestRunResults", "createMany", args, r);
    expect(args.data.map((row) => row.attempt)).toEqual([1, 2, 4]);
    expect(r.testRunResults.findMany).toHaveBeenCalledTimes(2);
  });

  it("ignores other models and operations", async () => {
    const r = reader();
    const args = { data: { testRunCaseId: 50 } };
    await assignResultAttempts("TestRunResults", "update", args, r);
    await assignResultAttempts("TestRunStepResults", "create", args, r);
    expect(args.data).toEqual({ testRunCaseId: 50 });
    expect(r.testRunResults.findMany).not.toHaveBeenCalled();
  });
});
