import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveLeaseApiUser: vi.fn(),
  loadReadableDataset: vi.fn(),
  releaseRow: vi.fn(),
  emitReleased: vi.fn(async (..._args: any[]) => undefined),
}));

vi.mock("~/lib/services/datasetLease", () => ({
  resolveLeaseApiUser: mocks.resolveLeaseApiUser,
  loadReadableDataset: mocks.loadReadableDataset,
  releaseRow: mocks.releaseRow,
}));

vi.mock("~/lib/webhooks/event-emitters/datasetLeaseEvents", () => ({
  emitDatasetRowReleased: (...args: any[]) => mocks.emitReleased(...args),
}));

vi.mock("~/lib/db", () => ({
  baseDb: { $transaction: async (cb: any) => cb({}) },
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (fn: any) => fn,
  enrichFromApiAuth: vi.fn(),
}));

import { POST } from "./route";

function buildReq(
  dataSetId: string,
  rowId: string,
  body?: unknown
): [NextRequest, { params: Promise<{ dataSetId: string; rowId: string }> }] {
  const req = new NextRequest(
    `http://localhost/api/datasets/${dataSetId}/rows/${rowId}/release`,
    {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }
  );
  return [req, { params: Promise.resolve({ dataSetId, rowId }) }];
}

const okUser = {
  ok: true as const,
  user: { userId: "user-1", access: "GLOBAL" },
};

describe("POST /api/datasets/[dataSetId]/rows/[rowId]/release", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveLeaseApiUser.mockResolvedValue(okUser);
    mocks.loadReadableDataset.mockResolvedValue({ id: 3, projectId: 42 });
  });

  it("released:true and emits on a token match", async () => {
    mocks.releaseRow.mockResolvedValue({
      status: "released",
      row: {
        id: 9,
        rowIndex: 0,
        label: "row-0",
        leasedById: "user-1",
        leaseExpiresAt: new Date("2026-07-15T12:05:00.000Z"),
      },
    });
    const res = await POST(...buildReq("3", "9", { leaseToken: "lease_x" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ released: true, rowId: 9 });
    expect(mocks.emitReleased).toHaveBeenCalledTimes(1);
    // reason discriminator forwarded
    expect(mocks.emitReleased.mock.calls[0][1]).toBe("released");
  });

  it("passes isAdmin through so admins can force-release", async () => {
    mocks.resolveLeaseApiUser.mockResolvedValue({
      ok: true,
      user: { userId: "admin-1", access: "ADMIN" },
    });
    mocks.releaseRow.mockResolvedValue({
      status: "released",
      row: {
        id: 9,
        rowIndex: 0,
        label: null,
        leasedById: "other-user",
        leaseExpiresAt: null,
      },
    });
    await POST(...buildReq("3", "9", {}));
    expect(mocks.releaseRow.mock.calls[0][1].isAdmin).toBe(true);
  });

  it("409 lease_conflict on a token mismatch", async () => {
    mocks.releaseRow.mockResolvedValue({ status: "conflict" });
    const res = await POST(...buildReq("3", "9", { leaseToken: "wrong" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("lease_conflict");
    expect(mocks.emitReleased).not.toHaveBeenCalled();
  });

  it("200 released:false (idempotent) when already free", async () => {
    mocks.releaseRow.mockResolvedValue({ status: "not_leased" });
    const res = await POST(...buildReq("3", "9", { leaseToken: "lease_x" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ released: false, reason: "not_leased" });
  });

  it("404 when the row is not found", async () => {
    mocks.releaseRow.mockResolvedValue({ status: "not_found" });
    const res = await POST(...buildReq("3", "9", { leaseToken: "lease_x" }));
    expect(res.status).toBe(404);
  });

  it("404 when the dataset is not readable", async () => {
    mocks.loadReadableDataset.mockResolvedValue(null);
    const res = await POST(...buildReq("3", "9", { leaseToken: "lease_x" }));
    expect(res.status).toBe(404);
    expect(mocks.releaseRow).not.toHaveBeenCalled();
  });
});
