/**
 * DSET-01 invariant: at most one attached DataSet per case.
 *
 * The POST /api/repository/cases/[caseId]/dataset endpoint is idempotent:
 * - Calling POST when no dataset exists creates one and returns it.
 * - Calling POST when a dataset already exists returns the EXISTING dataset
 *   and creates no new row.
 *
 * Wiring contract test — the route never calls dataSet.create when a
 * matching row already exists. This test exercises the route handler with
 * a mocked enhanced DB so we don't depend on a live database.
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, sessionRef } = vi.hoisted(() => {
  const db: any = {
    repositoryCases: { findFirst: vi.fn() },
    dataSet: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    mockDb: db,
    sessionRef: { current: { user: { id: "u-1", name: "U", email: "u@e.com" } } },
  };
});

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => mockDb),
}));

import { POST as datasetPost } from "~/app/api/repository/cases/[caseId]/dataset/route";

function jsonRequest(): NextRequest {
  return { json: async () => ({}) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DSET-01 — single-attachment-per-case", () => {
  it("creates a new dataset when none exists; returns it", async () => {
    mockDb.repositoryCases.findFirst = vi.fn(async () => ({
      id: 5,
      projectId: 100,
      name: "Login flow",
    }));
    mockDb.dataSet.findFirst = vi.fn(async () => null);
    mockDb.dataSet.create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 999,
      ...args.data,
    }));

    const res = await datasetPost(jsonRequest(), {
      params: Promise.resolve({ caseId: "5" }),
    });
    expect(res.status).toBe(200);
    expect(mockDb.dataSet.create).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.dataset.id).toBe(999);
  });

  it("is idempotent — returns existing dataset without creating a new row", async () => {
    mockDb.repositoryCases.findFirst = vi.fn(async () => ({
      id: 5,
      projectId: 100,
      name: "Login flow",
    }));
    mockDb.dataSet.findFirst = vi.fn(async () => ({
      id: 42,
      projectId: 100,
      ownerCaseId: 5,
      name: "Existing",
    }));

    const res = await datasetPost(jsonRequest(), {
      params: Promise.resolve({ caseId: "5" }),
    });
    expect(res.status).toBe(200);
    expect(mockDb.dataSet.create).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.dataset.id).toBe(42);
  });

  it("returns 404 when the case is missing", async () => {
    mockDb.repositoryCases.findFirst = vi.fn(async () => null);
    const res = await datasetPost(jsonRequest(), {
      params: Promise.resolve({ caseId: "999" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    sessionRef.current = null as never;
    const res = await datasetPost(jsonRequest(), {
      params: Promise.resolve({ caseId: "5" }),
    });
    expect(res.status).toBe(401);
    sessionRef.current = { user: { id: "u-1", name: "U", email: "u@e.com" } };
  });

  it("scopes the existence check by projectId (cross-project filter)", async () => {
    mockDb.repositoryCases.findFirst = vi.fn(async () => ({
      id: 5,
      projectId: 100,
      name: "Case",
    }));
    mockDb.dataSet.findFirst = vi.fn(async () => null);
    mockDb.dataSet.create = vi.fn(async () => ({ id: 1 }));

    await datasetPost(jsonRequest(), {
      params: Promise.resolve({ caseId: "5" }),
    });

    const args = mockDb.dataSet.findFirst.mock.calls[0][0];
    expect(args.where).toMatchObject({
      ownerCaseId: 5,
      projectId: 100,
      isDeleted: false,
    });
  });
});
