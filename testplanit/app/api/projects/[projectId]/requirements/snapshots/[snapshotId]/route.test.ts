// Route tests for traceability snapshot soft-delete: the gate order and
// the exact write, with the DB stubbed at the raw-client seam.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: any) => handler,
}));
vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));
vi.mock("~/lib/services/areaPermission", () => ({
  userHasAreaPermission: vi.fn(),
}));
vi.mock("~/lib/db", () => ({
  baseDb: {
    requirementTraceabilitySnapshot: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { userHasAreaPermission } from "~/lib/services/areaPermission";

import { DELETE } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedPermission = userHasAreaPermission as unknown as ReturnType<
  typeof vi.fn
>;
const mockedFindFirst = baseDb.requirementTraceabilitySnapshot
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = baseDb.requirementTraceabilitySnapshot
  .update as unknown as ReturnType<typeof vi.fn>;

function makeRequest(): NextRequest {
  return new NextRequest(
    "http://localhost/api/projects/5/requirements/snapshots/42",
    { method: "DELETE" }
  );
}

const params = (projectId = "5", snapshotId = "42") => ({
  params: Promise.resolve({ projectId, snapshotId }),
});

describe("DELETE /api/projects/[projectId]/requirements/snapshots/[snapshotId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({ user: { id: "user-1", access: "USER" } });
    mockedScope.mockResolvedValue([5]);
    mockedPermission.mockResolvedValue(true);
    mockedFindFirst.mockResolvedValue({ id: 42 });
    mockedUpdate.mockResolvedValue({ id: 42 });
  });

  it("401s without a session", async () => {
    mockedSession.mockResolvedValue(null);
    expect((await DELETE(makeRequest(), params())).status).toBe(401);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("400s non-numeric ids", async () => {
    expect((await DELETE(makeRequest(), params("x", "42"))).status).toBe(400);
    expect((await DELETE(makeRequest(), params("5", "0"))).status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("403s outside the viewer's project scope, before the permission read", async () => {
    mockedScope.mockResolvedValue([6]);
    expect((await DELETE(makeRequest(), params())).status).toBe(403);
    expect(mockedPermission).not.toHaveBeenCalled();
  });

  it("403s without Reporting DELETE on the project (not add/edit)", async () => {
    mockedPermission.mockResolvedValue(false);
    expect((await DELETE(makeRequest(), params())).status).toBe(403);
    expect(mockedPermission).toHaveBeenCalledWith(
      "user-1",
      5,
      "Reporting",
      "canDelete"
    );
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("404s a snapshot that is not a live record of this project", async () => {
    mockedFindFirst.mockResolvedValue(null);
    expect((await DELETE(makeRequest(), params())).status).toBe(404);
    expect(mockedFindFirst).toHaveBeenCalledWith({
      where: { id: 42, projectId: 5, isDeleted: false },
      select: { id: true },
    });
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("soft-deletes with a deletedAt stamp and returns the id", async () => {
    const response = await DELETE(makeRequest(), params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 42 });
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    const call = mockedUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: 42 });
    expect(call.data.isDeleted).toBe(true);
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("500s with a generic body when the write throws", async () => {
    mockedUpdate.mockRejectedValue(new Error("boom"));
    const response = await DELETE(makeRequest(), params());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to delete requirement traceability snapshot",
    });
  });
});
