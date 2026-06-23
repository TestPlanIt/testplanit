/**
 * CSV import atomicity contract:
 *
 * - Body validates against `buildRowSchemaFromParameters` BEFORE any DB
 *   write. If ANY row fails, the whole commit aborts (no inserts).
 * - Replace mode soft-deletes existing rows (NEVER hard-deletes) inside
 *   the same `$transaction` as the new inserts.
 * - Append mode preserves existing rows; new rows get `rowIndex = max + 1`.
 * - 5 MB body cap is enforced server-side.
 *
 * Wiring contract test against a mocked enhanced DB.
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockTx, auditedTxSpy, sessionRef, txCalls } = vi.hoisted(() => {
  const calls: { op: string; args: unknown[] }[] = [];
  const tx: any = {
    dataSetRow: {
      updateMany: vi.fn(async (args: unknown) => {
        calls.push({ op: "dataSetRow.updateMany", args: [args] });
        return { count: 0 };
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        calls.push({ op: "dataSetRow.create", args: [args] });
        return { id: Math.floor(Math.random() * 10000), ...args.data };
      }),
      aggregate: vi.fn(async () => ({ _max: { rowIndex: null } })),
    },
    dataSet: {
      findFirst: vi.fn(async () => ({
        id: 50,
        ownerCaseId: 5,
        projectId: 100,
      })),
      create: vi.fn(),
    },
    testCaseParameter: {
      count: vi.fn(async () => 2),
    },
    repositoryCases: {
      update: vi.fn(async () => ({})),
    },
  };
  const db: any = {
    repositoryCases: { findFirst: vi.fn() },
    testCaseParameter: { findMany: vi.fn() },
    dataSet: { findFirst: vi.fn() },
    dataSetRow: { aggregate: vi.fn() },
  };
  // The route reads through getEnhancedDb (mockDb) then commits through
  // auditedEnhancedTransaction (GUC + tx enhance), whose internals have their
  // own tests. Run the caller's callback with mockTx so the soft-delete /
  // insert / rowIndex wiring runs against the in-memory tx mocks.
  const auditedTx = vi.fn(
    async (_session: unknown, fn: (t: any) => Promise<unknown>) => {
      calls.length = 0;
      return fn(tx);
    }
  );
  return {
    mockDb: db,
    mockTx: tx,
    auditedTxSpy: auditedTx,
    sessionRef: {
      current: { user: { id: "u-1", name: "U", email: "u@e.com" } },
    },
    txCalls: calls,
  };
});

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => mockDb),
}));
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedEnhancedTransaction: auditedTxSpy,
}));

import { POST as importCsvPost } from "~/app/api/repository/cases/[caseId]/dataset/import-csv/route";

function jsonRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  txCalls.length = 0;
  mockDb.repositoryCases.findFirst = vi.fn(async () => ({
    id: 5,
    projectId: 100,
  }));
  mockDb.testCaseParameter.findMany = vi.fn(async () => [
    {
      name: "username",
      type: "STRING",
      required: true,
      allowedValuesJson: null,
      lookupDataSetId: null,
    },
    {
      name: "count",
      type: "INTEGER",
      required: true,
      allowedValuesJson: null,
      lookupDataSetId: null,
    },
  ]);
  mockDb.dataSet.findFirst = vi.fn(async () => ({
    id: 50,
    ownerCaseId: 5,
    projectId: 100,
  }));
  mockDb.dataSetRow.aggregate = vi.fn(async () => ({
    _max: { rowIndex: null },
  }));
  // Reset tx mocks
  mockTx.dataSetRow.updateMany.mockClear();
  mockTx.dataSetRow.create.mockClear();
  mockTx.dataSetRow.aggregate.mockClear();
  mockTx.dataSet.findFirst.mockClear();
});

describe("CSV import atomicity", () => {
  it("rejects with 400 if any row fails Zod validation; NO DB writes happen", async () => {
    const res = await importCsvPost(
      jsonRequest({
        mode: "replace",
        mapping: { Username: "username", Count: "count" },
        rows: [
          { Username: "alice", Count: "10" },
          { Username: "bob", Count: "not-a-number" }, // invalid INTEGER
        ],
      }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect(res.status).toBe(400);
    expect(auditedTxSpy).not.toHaveBeenCalled();
  });

  it("replace mode soft-deletes existing rows then inserts new rows in one tx", async () => {
    const res = await importCsvPost(
      jsonRequest({
        mode: "replace",
        mapping: { Username: "username", Count: "count" },
        rows: [
          { Username: "alice", Count: "10" },
          { Username: "bob", Count: "20" },
        ],
      }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect(res.status).toBe(200);
    expect(auditedTxSpy).toHaveBeenCalledTimes(1);
    expect(mockTx.dataSetRow.updateMany).toHaveBeenCalledTimes(1);
    const updateArgs = mockTx.dataSetRow.updateMany.mock.calls[0][0];
    expect(updateArgs.data).toMatchObject({ isDeleted: true });
    expect(mockTx.dataSetRow.create).toHaveBeenCalledTimes(2);
  });

  it("append mode preserves existing rows; new rows start at max+1", async () => {
    mockTx.dataSetRow.aggregate = vi.fn(async () => ({
      _max: { rowIndex: 4 },
    }));

    const res = await importCsvPost(
      jsonRequest({
        mode: "append",
        mapping: { Username: "username", Count: "count" },
        rows: [
          { Username: "carol", Count: "30" },
          { Username: "dave", Count: "40" },
        ],
      }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect(res.status).toBe(200);
    expect(mockTx.dataSetRow.updateMany).not.toHaveBeenCalled();
    expect(mockTx.dataSetRow.create).toHaveBeenCalledTimes(2);
    const firstRow = mockTx.dataSetRow.create.mock.calls[0][0];
    const secondRow = mockTx.dataSetRow.create.mock.calls[1][0];
    expect(firstRow.data.rowIndex).toBe(5);
    expect(secondRow.data.rowIndex).toBe(6);
  });

  it("rejects when body is larger than 5 MB", async () => {
    // Build a body whose JSON length exceeds 5 MB
    const bigString = "x".repeat(5 * 1024 * 1024 + 100);
    const res = await importCsvPost(
      jsonRequest({
        mode: "append",
        mapping: { Username: "username", Count: "count" },
        rows: [{ Username: bigString, Count: "1" }],
      }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect([400, 413]).toContain(res.status);
  });

  it("skips unmapped CSV columns when mapping value is __skip__", async () => {
    const res = await importCsvPost(
      jsonRequest({
        mode: "append",
        mapping: { Username: "username", Count: "count", Comment: "__skip__" },
        rows: [{ Username: "alice", Count: "10", Comment: "ignored" }],
      }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect(res.status).toBe(200);
    const created = mockTx.dataSetRow.create.mock.calls[0][0];
    expect(created.data.valuesJson).toMatchObject({
      username: "alice",
      count: 10,
    });
    // Comment should NOT be in the persisted values
    expect(created.data.valuesJson.Comment).toBeUndefined();
  });

  it("rejects with 400 if a required parameter is missing from mapping", async () => {
    const res = await importCsvPost(
      jsonRequest({
        mode: "append",
        // Missing 'count' mapping — required parameter is unfilled
        mapping: { Username: "username" },
        rows: [{ Username: "alice", Count: "10" }],
      }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect(res.status).toBe(400);
    expect(auditedTxSpy).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    sessionRef.current = null as never;
    const res = await importCsvPost(
      jsonRequest({ mode: "append", mapping: {}, rows: [] }),
      { params: Promise.resolve({ caseId: "5" }) }
    );
    expect(res.status).toBe(401);
    sessionRef.current = { user: { id: "u-1", name: "U", email: "u@e.com" } };
  });
});
