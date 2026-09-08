import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveLeaseApiUser: vi.fn(),
  loadReadableDataset: vi.fn(),
  extendLease: vi.fn(),
}));

vi.mock("~/lib/services/datasetLease", () => ({
  resolveLeaseApiUser: mocks.resolveLeaseApiUser,
  loadReadableDataset: mocks.loadReadableDataset,
  extendLease: mocks.extendLease,
  clampTtlSeconds: (n: number | undefined) => n ?? 300,
}));

vi.mock("~/lib/db", () => ({ baseDb: {} }));

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
    `http://localhost/api/datasets/${dataSetId}/rows/${rowId}/extend`,
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

describe("POST /api/datasets/[dataSetId]/rows/[rowId]/extend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveLeaseApiUser.mockResolvedValue(okUser);
    mocks.loadReadableDataset.mockResolvedValue({ id: 3, projectId: 42 });
  });

  it("extended:true with the new deadline", async () => {
    const newExpires = new Date("2026-07-15T12:10:00.000Z");
    mocks.extendLease.mockResolvedValue({
      status: "extended",
      row: {
        id: 9,
        rowIndex: 0,
        label: null,
        leasedById: "user-1",
        leaseExpiresAt: newExpires,
      },
    });
    const res = await POST(...buildReq("3", "9", { leaseToken: "lease_x" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({
      extended: true,
      leaseExpiresAt: newExpires.toISOString(),
    });
  });

  it("409 lease_expired when the TTL already lapsed", async () => {
    mocks.extendLease.mockResolvedValue({ status: "expired" });
    const res = await POST(...buildReq("3", "9", { leaseToken: "lease_x" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("lease_expired");
  });

  it("409 lease_conflict on a token mismatch", async () => {
    mocks.extendLease.mockResolvedValue({ status: "conflict" });
    const res = await POST(...buildReq("3", "9", { leaseToken: "wrong" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("lease_conflict");
  });

  it("409 not_leased when the row is free", async () => {
    mocks.extendLease.mockResolvedValue({ status: "not_leased" });
    const res = await POST(...buildReq("3", "9", { leaseToken: "lease_x" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_leased");
  });

  it("404 when the row is not found", async () => {
    mocks.extendLease.mockResolvedValue({ status: "not_found" });
    const res = await POST(...buildReq("3", "9", { leaseToken: "lease_x" }));
    expect(res.status).toBe(404);
  });

  it("404 when the dataset is not readable", async () => {
    mocks.loadReadableDataset.mockResolvedValue(null);
    const res = await POST(...buildReq("3", "9", { leaseToken: "lease_x" }));
    expect(res.status).toBe(404);
    expect(mocks.extendLease).not.toHaveBeenCalled();
  });
});
