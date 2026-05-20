import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

// Hoisted mocks (vi.mock is hoisted to the top of the file). All `vi.fn()`
// instances are created inside `vi.hoisted` so they exist when the
// factories evaluate.
const mocks = vi.hoisted(() => ({
  dataSetFindFirst: vi.fn(),
  dataSetVersionFindFirst: vi.fn(),
  assignmentCount: vi.fn(),
  txDataSetUpdate: vi.fn(),
  txAssignmentFindMany: vi.fn(),
  txAssignmentDelete: vi.fn(),
  // Cast through unknown so the wrapper can call `mocks.captureAuditEvent(...args)`
  // with an `any[]` arg list while preserving the resolved-promise return.
  captureAuditEvent: vi.fn(async () => undefined) as unknown as ReturnType<
    typeof vi.fn<(...args: any[]) => Promise<void>>
  >,
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    dataSet: { findFirst: mocks.dataSetFindFirst },
    dataSetVersion: { findFirst: mocks.dataSetVersionFindFirst },
    caseSharedDataSetAssignment: { count: mocks.assignmentCount },
  })),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    $transaction: async (cb: any) =>
      cb({
        dataSet: { update: mocks.txDataSetUpdate },
        caseSharedDataSetAssignment: {
          findMany: mocks.txAssignmentFindMany,
          delete: mocks.txAssignmentDelete,
        },
      }),
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mocks.captureAuditEvent(...args),
}));

import { getServerSession } from "next-auth";

import { DELETE, GET } from "./route";

const mockSession = {
  user: { id: "user-1", name: "Tester" },
};

const buildGet = (
  projectId: string,
  dataSetId: string
): [
  NextRequest,
  { params: Promise<{ projectId: string; dataSetId: string }> },
] => {
  const req = new NextRequest(
    `http://localhost/api/projects/${projectId}/datasets/${dataSetId}`
  );
  return [req, { params: Promise.resolve({ projectId, dataSetId }) }];
};

const buildDelete = (
  projectId: string,
  dataSetId: string,
  search = ""
): [
  NextRequest,
  { params: Promise<{ projectId: string; dataSetId: string }> },
] => {
  const req = new NextRequest(
    `http://localhost/api/projects/${projectId}/datasets/${dataSetId}${search}`,
    { method: "DELETE" }
  );
  return [req, { params: Promise.resolve({ projectId, dataSetId }) }];
};

describe("GET /api/projects/[projectId]/datasets/[dataSetId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const [req, ctx] = buildGet("1", "1");
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 400 when path params are non-numeric", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    const [req, ctx] = buildGet("x", "y");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the dataset does not exist or is not shared", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mocks.dataSetFindFirst.mockResolvedValue(null);

    const [req, ctx] = buildGet("1", "99");
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns dataset detail with latest version summary", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mocks.dataSetFindFirst.mockResolvedValue({
      id: 7,
      projectId: 1,
      name: "Test users",
      description: null,
      isShared: true,
      version: 3,
      createdAt: new Date("2026-05-01"),
      createdById: "user-1",
    });
    mocks.dataSetVersionFindFirst.mockResolvedValue({
      id: 50,
      version: 3,
      rowCount: 10,
      parametersJson: [{ name: "email" }],
      createdAt: new Date("2026-05-02"),
      createdById: "user-1",
    });

    const [req, ctx] = buildGet("1", "7");
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dataset.id).toBe(7);
    expect(json.latestVersion.version).toBe(3);
    expect(json.latestVersion.rowCount).toBe(10);

    // Latest-version lookup must order by version desc.
    const versionArgs = mocks.dataSetVersionFindFirst.mock.calls[0][0];
    expect(versionArgs.where).toEqual({ dataSetId: 7 });
    expect(versionArgs.orderBy).toEqual({ version: "desc" });
  });

  it("returns latestVersion=null when the dataset has no versions yet", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mocks.dataSetFindFirst.mockResolvedValue({
      id: 7,
      projectId: 1,
      name: "Test users",
      description: null,
      isShared: true,
      version: 1,
      createdAt: new Date("2026-05-01"),
      createdById: "user-1",
    });
    mocks.dataSetVersionFindFirst.mockResolvedValue(null);

    const [req, ctx] = buildGet("1", "7");
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.latestVersion).toBeNull();
  });
});

describe("DELETE /api/projects/[projectId]/datasets/[dataSetId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const [req, ctx] = buildDelete("1", "1");
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the dataset is missing or not shared", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mocks.dataSetFindFirst.mockResolvedValue(null);

    const [req, ctx] = buildDelete("1", "99");
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns ok and soft-deletes when there are no assignments and confirm not provided", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mocks.dataSetFindFirst.mockResolvedValue({ id: 7, name: "Test users" });
    mocks.assignmentCount.mockResolvedValue(0);

    const [req, ctx] = buildDelete("1", "7");
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.deletedAssignments).toBe(0);

    // Soft-delete (isDeleted: true), not a hard delete.
    expect(mocks.txDataSetUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.txDataSetUpdate.mock.calls[0][0]).toEqual({
      where: { id: 7 },
      data: { isDeleted: true },
    });
    // No assignment touch when count is zero.
    expect(mocks.txAssignmentFindMany).not.toHaveBeenCalled();
    expect(mocks.txAssignmentDelete).not.toHaveBeenCalled();
  });

  it("returns 409 with assignmentCount when assignments exist and confirm is missing", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mocks.dataSetFindFirst.mockResolvedValue({ id: 7, name: "Test users" });
    mocks.assignmentCount.mockResolvedValue(3);

    const [req, ctx] = buildDelete("1", "7");
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("has_assignments");
    expect(json.assignmentCount).toBe(3);

    // No mutation should happen on the 409 path.
    expect(mocks.txDataSetUpdate).not.toHaveBeenCalled();
    expect(mocks.txAssignmentDelete).not.toHaveBeenCalled();
  });

  it("returns ok and removes assignments when confirm=true and assignments exist", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mocks.dataSetFindFirst.mockResolvedValue({ id: 7, name: "Test users" });
    mocks.assignmentCount.mockResolvedValue(2);
    mocks.txAssignmentFindMany.mockResolvedValue([{ id: 11 }, { id: 12 }]);

    const [req, ctx] = buildDelete("1", "7", "?confirm=true");
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.deletedAssignments).toBe(2);

    expect(mocks.txDataSetUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.txAssignmentFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.txAssignmentDelete).toHaveBeenCalledTimes(2);
    // Per-row delete (not deleteMany) for policy-friendly mutation.
    expect(mocks.txAssignmentDelete.mock.calls[0][0]).toEqual({
      where: { id: 11 },
    });
    expect(mocks.txAssignmentDelete.mock.calls[1][0]).toEqual({
      where: { id: 12 },
    });
  });

  it("emits an audit event with action=DELETE and the affected assignment count", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mocks.dataSetFindFirst.mockResolvedValue({ id: 7, name: "Test users" });
    mocks.assignmentCount.mockResolvedValue(2);
    mocks.txAssignmentFindMany.mockResolvedValue([{ id: 11 }, { id: 12 }]);

    const [req, ctx] = buildDelete("1", "7", "?confirm=true");
    await DELETE(req, ctx);

    expect(mocks.captureAuditEvent).toHaveBeenCalledTimes(1);
    const event = mocks.captureAuditEvent.mock.calls[0][0];
    expect(event).toMatchObject({
      action: "DELETE",
      entityType: "DataSet",
      entityId: "7",
      entityName: "Test users",
      projectId: 1,
      userId: "user-1",
      metadata: {
        affectedAssignments: 2,
        confirmed: true,
      },
    });
  });
});
