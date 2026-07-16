import { describe, expect, it, vi } from "vitest";

// The module pulls in server-only deps at import time; stub them so the pure
// raw-SQL helpers (which take an explicit client) can be exercised in isolation.
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/api-token-auth", () => ({
  authenticateApiTokenForMethod: vi.fn(),
  extractBearerToken: vi.fn(),
}));
vi.mock("~/lib/auth/utils", () => ({ getUserWithRole: vi.fn() }));
vi.mock("~/lib/db", () => ({ baseDb: {} }));
vi.mock("~/lib/zenstack", () => ({ getAuthDb: vi.fn() }));

import {
  acquireNextRow,
  clampTtlSeconds,
  DEFAULT_LEASE_TTL_SECONDS,
  extendLease,
  MAX_LEASE_TTL_SECONDS,
  MIN_LEASE_TTL_SECONDS,
  mintLeaseToken,
  releaseRow,
} from "./datasetLease";

/** Build a fake client whose $queryRaw returns the given rows. */
function clientReturning(rows: unknown[]) {
  return { $queryRaw: vi.fn(async () => rows) } as any;
}

describe("clampTtlSeconds", () => {
  it("defaults when undefined or NaN", () => {
    expect(clampTtlSeconds(undefined)).toBe(DEFAULT_LEASE_TTL_SECONDS);
    expect(clampTtlSeconds(NaN)).toBe(DEFAULT_LEASE_TTL_SECONDS);
  });
  it("floors to the minimum", () => {
    expect(clampTtlSeconds(0)).toBe(MIN_LEASE_TTL_SECONDS);
    expect(clampTtlSeconds(-10)).toBe(MIN_LEASE_TTL_SECONDS);
  });
  it("caps at the maximum", () => {
    expect(clampTtlSeconds(999_999)).toBe(MAX_LEASE_TTL_SECONDS);
  });
  it("passes through and floors valid values", () => {
    expect(clampTtlSeconds(120)).toBe(120);
    expect(clampTtlSeconds(120.9)).toBe(120);
  });
});

describe("mintLeaseToken", () => {
  it("mints unique, prefixed opaque tokens", () => {
    const a = mintLeaseToken();
    const b = mintLeaseToken();
    expect(a).toMatch(/^lease_/);
    expect(a).not.toBe(b);
  });
});

describe("acquireNextRow", () => {
  it("returns the claimed row when one is free", async () => {
    const row = {
      id: 5,
      rowIndex: 0,
      label: null,
      valuesJson: { u: "a" },
      leasedById: "user-1",
      leasedAt: new Date(),
      leaseExpiresAt: new Date(),
      leaseToken: "lease_x",
    };
    const client = clientReturning([row]);
    const result = await acquireNextRow(client, {
      dataSetId: 3,
      userId: "user-1",
      ttlSeconds: 300,
      leaseToken: "lease_x",
    });
    expect(result).toEqual(row);
  });

  it("returns null when the pool is exhausted", async () => {
    const client = clientReturning([]);
    const result = await acquireNextRow(client, {
      dataSetId: 3,
      userId: "user-1",
      ttlSeconds: 300,
      leaseToken: "lease_x",
    });
    expect(result).toBeNull();
  });
});

describe("releaseRow classification", () => {
  const base = {
    id: 5,
    rowIndex: 1,
    label: "row-1",
    leasedById: "user-1",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    leaseToken: "lease_x",
  };

  it("released when the conditional clear updated the row", async () => {
    const client = clientReturning([{ ...base, updated: true }]);
    const out = await releaseRow(client, {
      dataSetId: 3,
      rowId: 5,
      leaseToken: "lease_x",
      isAdmin: false,
    });
    expect(out.status).toBe("released");
    if (out.status === "released") expect(out.row.id).toBe(5);
  });

  it("not_found when the row/dataset scope matched nothing", async () => {
    const client = clientReturning([]);
    const out = await releaseRow(client, {
      dataSetId: 3,
      rowId: 5,
      leaseToken: "lease_x",
      isAdmin: false,
    });
    expect(out.status).toBe("not_found");
  });

  it("not_leased (idempotent) when the row carries no token", async () => {
    const client = clientReturning([
      { ...base, leaseToken: null, updated: false },
    ]);
    const out = await releaseRow(client, {
      dataSetId: 3,
      rowId: 5,
      leaseToken: "whatever",
      isAdmin: false,
    });
    expect(out.status).toBe("not_leased");
  });

  it("conflict when a leased row was not cleared (token mismatch, non-admin)", async () => {
    const client = clientReturning([{ ...base, updated: false }]);
    const out = await releaseRow(client, {
      dataSetId: 3,
      rowId: 5,
      leaseToken: "wrong-token",
      isAdmin: false,
    });
    expect(out.status).toBe("conflict");
  });
});

describe("extendLease classification", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);
  const base = {
    id: 5,
    rowIndex: 1,
    label: "row-1",
    leasedById: "user-1",
    leaseToken: "lease_x",
    oldExpires: future,
    newExpires: new Date(Date.now() + 300_000),
    dbNow: new Date(),
  };

  it("extended when the update succeeded", async () => {
    const client = clientReturning([{ ...base, updated: true }]);
    const out = await extendLease(client, {
      dataSetId: 3,
      rowId: 5,
      leaseToken: "lease_x",
      ttlSeconds: 300,
      isAdmin: false,
    });
    expect(out.status).toBe("extended");
    if (out.status === "extended")
      expect(out.row.leaseExpiresAt).toEqual(base.newExpires);
  });

  it("not_found when nothing matched", async () => {
    const client = clientReturning([]);
    const out = await extendLease(client, {
      dataSetId: 3,
      rowId: 5,
      leaseToken: "lease_x",
      ttlSeconds: 300,
      isAdmin: false,
    });
    expect(out.status).toBe("not_found");
  });

  it("not_leased when the row carries no token", async () => {
    const client = clientReturning([
      { ...base, leaseToken: null, updated: false },
    ]);
    const out = await extendLease(client, {
      dataSetId: 3,
      rowId: 5,
      leaseToken: "lease_x",
      ttlSeconds: 300,
      isAdmin: false,
    });
    expect(out.status).toBe("not_leased");
  });

  it("expired when a leased row's TTL has already lapsed (must re-acquire)", async () => {
    const client = clientReturning([
      { ...base, oldExpires: past, updated: false },
    ]);
    const out = await extendLease(client, {
      dataSetId: 3,
      rowId: 5,
      leaseToken: "lease_x",
      ttlSeconds: 300,
      isAdmin: false,
    });
    expect(out.status).toBe("expired");
  });

  it("conflict when live+leased but token mismatched (non-admin)", async () => {
    const client = clientReturning([
      { ...base, oldExpires: future, updated: false },
    ]);
    const out = await extendLease(client, {
      dataSetId: 3,
      rowId: 5,
      leaseToken: "wrong",
      ttlSeconds: 300,
      isAdmin: false,
    });
    expect(out.status).toBe("conflict");
  });
});
