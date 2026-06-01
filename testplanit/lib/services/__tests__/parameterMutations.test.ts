import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/services/parameterMaintenance", () => ({
  updateHasParameters: vi.fn(async () => undefined),
}));

vi.mock("~/lib/services/testCaseVersionService", () => ({
  createTestCaseVersionInTransaction: vi.fn(async () => ({ id: 100 })),
}));

vi.mock("~/lib/services/parameterReferences", () => ({
  scanParameterReferences: vi.fn(async () => ({
    stepCount: 0,
    expectedCount: 0,
    rowCount: 0,
    steps: [],
    rows: [],
  })),
  rewriteParameterReferences: vi.fn(async () => undefined),
}));

import { updateHasParameters } from "~/lib/services/parameterMaintenance";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import { rewriteParameterReferences } from "~/lib/services/parameterReferences";
import {
  createParameterInTransaction,
  updateParameterInTransaction,
  softDeleteParameterInTransaction,
} from "~/lib/services/parameterMutations";

const session = { id: "user-1", name: "User One", email: "u@example.com" };

interface BuildTxOpts {
  existingParam?: { id: number; name: string; testCaseId: number } | null;
  createReturn?: unknown;
  updateReturn?: unknown;
}

function buildTx(opts: BuildTxOpts = {}) {
  const calls: string[] = [];
  const tx = {
    testCaseParameter: {
      // Create-path is now an upsert so a soft-deleted parameter with
      // the same (testCaseId, name) gets resurrected instead of 23505ing.
      // The mock honors `createReturn` for the "no soft-deleted match"
      // case to stay compatible with existing assertions on the result
      // shape.
      upsert: vi.fn(
        async (args: {
          where: Record<string, unknown>;
          create: Record<string, unknown>;
        }) => {
          calls.push("testCaseParameter.upsert");
          return opts.createReturn ?? { id: 1, ...args.create };
        }
      ),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        calls.push("testCaseParameter.create");
        return opts.createReturn ?? { id: 1, ...args.data };
      }),
      update: vi.fn(
        async (args: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          calls.push("testCaseParameter.update");
          return (
            opts.updateReturn ?? {
              id: args.where.id,
              ...(opts.existingParam ?? {}),
              ...args.data,
            }
          );
        }
      ),
      findFirst: vi.fn(async () => opts.existingParam ?? null),
    },
    repositoryCases: {
      update: vi.fn(async (args: Record<string, unknown>) => {
        calls.push("repositoryCases.update");
        return args;
      }),
    },
  };
  return { tx, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createParameterInTransaction", () => {
  it("calls create + updateHasParameters + currentVersion increment + version snapshot, in order", async () => {
    const { tx, calls } = buildTx();
    await createParameterInTransaction(
      tx,
      42,
      {
        testCaseId: 42,
        name: "username",
        type: "STRING",
        description: null,
        defaultValue: null,
        order: 0,
        required: false,
        sensitive: false,
        allowedValuesJson: null,
        lookupDataSetId: null,
      },
      session
    );

    expect(tx.testCaseParameter.upsert).toHaveBeenCalledTimes(1);
    expect(updateHasParameters).toHaveBeenCalledTimes(1);
    expect(updateHasParameters).toHaveBeenCalledWith(42, tx);

    // currentVersion increment must happen
    expect(tx.repositoryCases.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42 },
        data: expect.objectContaining({
          currentVersion: { increment: 1 },
        }),
      })
    );

    expect(createTestCaseVersionInTransaction).toHaveBeenCalledTimes(1);
    expect(createTestCaseVersionInTransaction).toHaveBeenCalledWith(
      tx,
      42,
      expect.objectContaining({
        creatorId: "user-1",
        creatorName: expect.any(String),
      })
    );

    // Order: upsert -> updateHasParameters -> repositoryCases.update -> snapshot
    const createIdx = calls.indexOf("testCaseParameter.upsert");
    const repoIdx = calls.indexOf("repositoryCases.update");
    expect(createIdx).toBeLessThan(repoIdx);
  });
});

describe("updateParameterInTransaction", () => {
  it("calls update + version invariants without rewrite when name unchanged", async () => {
    const { tx } = buildTx({
      existingParam: { id: 7, name: "username", testCaseId: 42 },
    });

    await updateParameterInTransaction(tx, 42, 7, { sensitive: true }, session);

    expect(tx.testCaseParameter.update).toHaveBeenCalledTimes(1);
    expect(rewriteParameterReferences).not.toHaveBeenCalled();
    expect(updateHasParameters).toHaveBeenCalledWith(42, tx);
    expect(createTestCaseVersionInTransaction).toHaveBeenCalledTimes(1);
  });

  it("invokes rewriteParameterReferences when name changes", async () => {
    const { tx } = buildTx({
      existingParam: { id: 7, name: "old", testCaseId: 42 },
    });

    await updateParameterInTransaction(tx, 42, 7, { name: "new" }, session);

    expect(rewriteParameterReferences).toHaveBeenCalledWith(
      tx,
      42,
      "old",
      "new"
    );
    expect(rewriteParameterReferences).toHaveBeenCalledTimes(1);
  });
});

describe("softDeleteParameterInTransaction", () => {
  it("performs soft delete (isDeleted: true) and invokes invariants — never tx.delete", async () => {
    const { tx } = buildTx({
      existingParam: { id: 9, name: "username", testCaseId: 42 },
    });

    await softDeleteParameterInTransaction(tx, 42, 9, session);

    // Must use update, not delete
    expect(tx.testCaseParameter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9 },
        data: expect.objectContaining({ isDeleted: true }),
      })
    );
    expect(updateHasParameters).toHaveBeenCalledWith(42, tx);
    expect(createTestCaseVersionInTransaction).toHaveBeenCalledTimes(1);
  });
});
