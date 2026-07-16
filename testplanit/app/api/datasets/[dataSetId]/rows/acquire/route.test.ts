import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveLeaseApiUser: vi.fn(),
  loadReadableDataset: vi.fn(),
  acquireNextRow: vi.fn(),
  emitAcquired: vi.fn(async (..._args: any[]) => undefined),
}));

vi.mock("~/lib/services/datasetLease", () => ({
  resolveLeaseApiUser: mocks.resolveLeaseApiUser,
  loadReadableDataset: mocks.loadReadableDataset,
  acquireNextRow: mocks.acquireNextRow,
  clampTtlSeconds: (n: number | undefined) => n ?? 300,
  mintLeaseToken: () => "lease_fixed",
}));

vi.mock("~/lib/webhooks/event-emitters/datasetLeaseEvents", () => ({
  emitDatasetRowAcquired: (...args: any[]) => mocks.emitAcquired(...args),
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
  body?: unknown
): [NextRequest, { params: Promise<{ dataSetId: string }> }] {
  const req = new NextRequest(
    `http://localhost/api/datasets/${dataSetId}/rows/acquire`,
    {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }
  );
  return [req, { params: Promise.resolve({ dataSetId }) }];
}

const okUser = {
  ok: true as const,
  user: { userId: "user-1", access: "GLOBAL" },
};

describe("POST /api/datasets/[dataSetId]/rows/acquire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveLeaseApiUser.mockResolvedValue(okUser);
    mocks.loadReadableDataset.mockResolvedValue({ id: 3, projectId: 42 });
  });

  it("400 on a non-numeric dataset id", async () => {
    const res = await POST(...buildReq("abc"));
    expect(res.status).toBe(400);
  });

  it("passes through the auth error status (401)", async () => {
    mocks.resolveLeaseApiUser.mockResolvedValue({
      ok: false,
      error: "Unauthorized",
      status: 401,
    });
    const res = await POST(...buildReq("3"));
    expect(res.status).toBe(401);
  });

  it("404 when the dataset is not readable (not a member)", async () => {
    mocks.loadReadableDataset.mockResolvedValue(null);
    const res = await POST(...buildReq("3"));
    expect(res.status).toBe(404);
    expect(mocks.acquireNextRow).not.toHaveBeenCalled();
  });

  it("returns the claimed row + token and emits acquired", async () => {
    const expires = new Date("2026-07-15T12:05:00.000Z");
    mocks.acquireNextRow.mockResolvedValue({
      id: 9,
      rowIndex: 0,
      label: "row-0",
      valuesJson: { user: "alice" },
      leasedById: "user-1",
      leasedAt: new Date(),
      leaseExpiresAt: expires,
      leaseToken: "lease_fixed",
    });
    const res = await POST(...buildReq("3", { ttlSeconds: 600 }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({
      acquired: true,
      row: {
        id: 9,
        rowIndex: 0,
        label: "row-0",
        valuesJson: { user: "alice" },
      },
      leaseToken: "lease_fixed",
      leaseExpiresAt: expires.toISOString(),
    });
    expect(mocks.emitAcquired).toHaveBeenCalledTimes(1);
    // SECURITY: the emitted payload must not carry valuesJson.
    const emittedPayload = mocks.emitAcquired.mock.calls[0][0];
    expect(emittedPayload).not.toHaveProperty("valuesJson");
  });

  it("returns acquired:false with no emit when the pool is exhausted", async () => {
    mocks.acquireNextRow.mockResolvedValue(null);
    const res = await POST(...buildReq("3"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ acquired: false, row: null });
    expect(mocks.emitAcquired).not.toHaveBeenCalled();
  });

  it("tolerates a missing request body (defaults the TTL)", async () => {
    mocks.acquireNextRow.mockResolvedValue(null);
    const res = await POST(...buildReq("3", undefined));
    expect(res.status).toBe(200);
    expect(mocks.acquireNextRow).toHaveBeenCalledTimes(1);
  });
});
