import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the route handler.
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: any) => handler,
}));

const { mockFindFirst, mockUpdateMany } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  baseDb: {
    integrationProject: {
      findFirst: mockFindFirst,
      updateMany: mockUpdateMany,
    },
  },
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: vi.fn(),
}));

vi.mock("@/lib/integrations/services/SyncService", () => ({
  SYNC_STATUS: {
    syncing: "syncing",
    cancelRequested: "cancel-requested",
    cancelled: "cancelled",
    completed: "completed",
    error: "error",
  },
}));

import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedFindFirst = baseDb.integrationProject
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedUpdateMany = baseDb.integrationProject
  .updateMany as unknown as ReturnType<typeof vi.fn>;
const mockedAuth = authorizeProjectAdminForProject as unknown as ReturnType<
  typeof vi.fn
>;

const params = { params: Promise.resolve({ id: "4" }) };

function makeRequest(body?: unknown, rawBody?: string): NextRequest {
  return new NextRequest(
    "http://localhost/api/integrations/4/requirements-import/cancel",
    {
      method: "POST",
      body: rawBody !== undefined ? rawBody : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("POST /api/integrations/[id]/requirements-import/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedAuth.mockResolvedValue({ ok: true, status: 200, projectId: 42 });
    mockedFindFirst.mockResolvedValue({
      id: "ip-1",
      syncStatus: "syncing",
      projectIntegration: { config: {} },
    });
    mockedUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("returns 401 when there is no session", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(401);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 400 when the integration id is not numeric", async () => {
    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      { params: Promise.resolve({ id: "abc" }) }
    );

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await POST(makeRequest(undefined, "{not json"), params);

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("returns 400 when projectId is missing or not a positive integer", async () => {
    const res = await POST(
      makeRequest({ projectId: "42", integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("returns 400 when integrationProjectId is missing or not a string", async () => {
    const res = await POST(makeRequest({ projectId: 42 }), params);

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("returns 400 before 403 — a non-admin session with a malformed body gets 400, not 403", async () => {
    mockedAuth.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const res = await POST(makeRequest({ projectId: 42 }), params);

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("returns 403 and performs no write when the caller is not a project admin for a genuinely running import", async () => {
    mockedAuth.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(403);
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the mapping does not belong to the caller's authorized project (cross-project aim)", async () => {
    mockedFindFirst.mockResolvedValue(null);

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-owned-by-99" }),
      params
    );

    expect(res.status).toBe(404);
    expect(mockedFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "ip-owned-by-99",
          isActive: true,
          projectIntegration: expect.objectContaining({
            projectId: 42,
            integrationId: 4,
            isActive: true,
          }),
        }),
      })
    );
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 409 and changes nothing when the mapping is not currently syncing", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "ip-1",
      syncStatus: "completed",
      projectIntegration: { config: {} },
    });
    mockedUpdateMany.mockResolvedValue({ count: 0 });

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(409);
    // The write is attempted but matches nothing: the running-state check
    // lives in the WHERE clause, which is what makes it safe against an
    // import that finishes between the read and the write.
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: "ip-1", syncStatus: "syncing" },
      data: { syncStatus: "cancel-requested" },
    });
  });

  it("does NOT overwrite a terminal state when the import completes between the read and the write", async () => {
    // The read sees a running import...
    mockedFindFirst.mockResolvedValue({
      id: "ip-1",
      syncStatus: "syncing",
      projectIntegration: { config: {} },
    });
    // ...but by the time the write lands, the worker has written `completed`,
    // so the guarded update matches no rows. Without the guard this would
    // stamp `cancel-requested` over the terminal state, leaving a mapping the
    // start route refuses ("already running") and the cancel route refuses
    // ("nothing to cancel") -- unreachable by any button.
    mockedUpdateMany.mockResolvedValue({ count: 0 });

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(409);
  });

  it("returns 409 and performs no duplicate write on a second cancel while already cancel-requested", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "ip-1",
      syncStatus: "cancel-requested",
      projectIntegration: { config: {} },
    });
    // The guarded update matches nothing: the row is no longer `syncing`.
    mockedUpdateMany.mockResolvedValue({ count: 0 });

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(409);
  });

  it("writes exactly { syncStatus: cancel-requested } and returns 200 for a running import", async () => {
    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });

    expect(mockedUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: "ip-1", syncStatus: "syncing" },
      data: { syncStatus: "cancel-requested" },
    });
  });
});
