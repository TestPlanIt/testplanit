/**
 * Phase 1 carry-forward gap (01-03-SUMMARY): the DataSet `@@deny` only
 * blocks cross-project create/update — NOT cross-project READ. Phase 2
 * authoring routes MUST filter `WHERE projectId = currentProjectId`
 * explicitly. This test asserts that the dataset GET endpoint returns
 * 404 (or null dataset) when a user attempts to fetch a dataset whose
 * `projectId` differs from the case's `projectId`.
 *
 * Wiring contract test — uses mocked enhanced DB to prove the route
 * applies the explicit projectId filter on the dataset query.
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, sessionRef, dataSetFindFirst } = vi.hoisted(() => {
  const dataSetFindFirstFn = vi.fn();
  const db: any = {
    repositoryCases: { findFirst: vi.fn() },
    dataSet: { findFirst: dataSetFindFirstFn },
    // The route counts rows for the pagination response shape after the
    // GET handler picked up `?page=` support — stub a default so tests
    // that don't care about totalRows don't crash.
    dataSetRow: { count: vi.fn(async () => 0) },
    testCaseParameter: { findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn() },
  };
  return {
    mockDb: db,
    sessionRef: { current: { user: { id: "u-A", name: "U", email: "u@e.com" } } },
    dataSetFindFirst: dataSetFindFirstFn,
  };
});

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => mockDb),
}));

import { GET as datasetGet } from "~/app/api/repository/cases/[caseId]/dataset/route";

function jsonRequest(body: unknown = {}): NextRequest {
  // The GET handler reads `new URL(request.url)` for pagination params,
  // so the stub needs a usable `url` even when callers only care about
  // `json()`.
  return {
    url: "http://test.local/api/repository/cases/5/dataset",
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cross-project dataset read filter (Phase 1 carry-forward)", () => {
  it("dataset query passes projectId from the case as an explicit WHERE filter", async () => {
    mockDb.repositoryCases.findFirst = vi.fn(async () => ({
      id: 5,
      projectId: 100,
    }));
    dataSetFindFirst.mockResolvedValueOnce({
      id: 7,
      projectId: 100,
      ownerCaseId: 5,
      rows: [],
    });

    await datasetGet(jsonRequest(), {
      params: Promise.resolve({ caseId: "5" }),
    });

    // The first dataSet.findFirst call must scope by projectId:100
    const args = dataSetFindFirst.mock.calls[0][0];
    expect(args.where).toMatchObject({
      ownerCaseId: 5,
      projectId: 100,
      isDeleted: false,
    });
  });

  it("returns dataset:null when the case is not found (cross-tenant blocked at policy)", async () => {
    mockDb.repositoryCases.findFirst = vi.fn(async () => null);

    const res = await datasetGet(jsonRequest(), {
      params: Promise.resolve({ caseId: "999" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns dataset:null when ownerCase exists but no dataset is attached yet", async () => {
    mockDb.repositoryCases.findFirst = vi.fn(async () => ({
      id: 5,
      projectId: 100,
    }));
    dataSetFindFirst.mockResolvedValueOnce(null);

    const res = await datasetGet(jsonRequest(), {
      params: Promise.resolve({ caseId: "5" }),
    });
    const body = await res.json();
    expect(body.dataset).toBeNull();
  });

  it("redacts sensitive values for users without canReadSensitive", async () => {
    mockDb.repositoryCases.findFirst = vi.fn(async () => ({
      id: 5,
      projectId: 100,
    }));
    dataSetFindFirst.mockResolvedValueOnce({
      id: 7,
      projectId: 100,
      ownerCaseId: 5,
      rows: [
        { id: 1, valuesJson: { username: "alice", password: "secret" } },
      ],
    });
    mockDb.testCaseParameter.findMany = vi.fn(async () => [
      { name: "username", sensitive: false },
      { name: "password", sensitive: true },
    ]);
    // No role -> no canReadSensitive
    mockDb.user.findUnique = vi.fn(async () => ({
      id: "u-A",
      access: "USER",
      role: { rolePermissions: [] },
    }));

    const res = await datasetGet(jsonRequest(), {
      params: Promise.resolve({ caseId: "5" }),
    });
    const body = await res.json();
    expect(body.dataset.rows[0].valuesJson).toMatchObject({
      username: "alice",
      password: "[REDACTED]",
    });
  });

  it("does NOT redact for ADMIN users (canReadSensitive bypassed via access=ADMIN)", async () => {
    mockDb.repositoryCases.findFirst = vi.fn(async () => ({
      id: 5,
      projectId: 100,
    }));
    dataSetFindFirst.mockResolvedValueOnce({
      id: 7,
      projectId: 100,
      ownerCaseId: 5,
      rows: [
        { id: 1, valuesJson: { username: "alice", password: "secret" } },
      ],
    });
    mockDb.testCaseParameter.findMany = vi.fn(async () => [
      { name: "username", sensitive: false },
      { name: "password", sensitive: true },
    ]);
    mockDb.user.findUnique = vi.fn(async () => ({
      id: "u-A",
      access: "ADMIN",
      role: { rolePermissions: [] },
    }));

    const res = await datasetGet(jsonRequest(), {
      params: Promise.resolve({ caseId: "5" }),
    });
    const body = await res.json();
    expect(body.dataset.rows[0].valuesJson.password).toBe("secret");
  });
});
