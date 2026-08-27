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

vi.mock("@/lib/db", () => ({
  baseDb: {
    integrationProject: { findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: vi.fn(),
}));

const { mockQueueProjectImport } = vi.hoisted(() => ({
  mockQueueProjectImport: vi.fn(),
}));

vi.mock("@/lib/integrations/services/SyncService", () => ({
  SYNC_STATUS: {
    syncing: "syncing",
    cancelRequested: "cancel-requested",
    cancelled: "cancelled",
    completed: "completed",
    error: "error",
  },
  syncService: { queueProjectImport: mockQueueProjectImport },
}));

import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedFindFirst = baseDb.integrationProject
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedAuth = authorizeProjectAdminForProject as unknown as ReturnType<
  typeof vi.fn
>;

const params = { params: Promise.resolve({ id: "4" }) };

function makeRequest(body?: unknown, rawBody?: string): NextRequest {
  return new NextRequest(
    "http://localhost/api/integrations/4/requirements-import",
    {
      method: "POST",
      body: rawBody !== undefined ? rawBody : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("POST /api/integrations/[id]/requirements-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedAuth.mockResolvedValue({ ok: true, status: 200, projectId: 42 });
    mockedFindFirst.mockResolvedValue({
      id: "ip-1",
      syncStatus: null,
      projectIntegration: {
        config: {
          requirements: { enabled: true, issueTypeIds: ["10001", "10002"] },
        },
      },
    });
    mockQueueProjectImport.mockResolvedValue("job-123");
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
    expect(mockQueueProjectImport).not.toHaveBeenCalled();
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

  it("returns 403 when the caller is not a project admin for the addressed project", async () => {
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
    expect(mockQueueProjectImport).not.toHaveBeenCalled();
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
    expect(mockQueueProjectImport).not.toHaveBeenCalled();
  });

  it("returns 409 and enqueues nothing when a mapping is already syncing", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "ip-1",
      syncStatus: "syncing",
      projectIntegration: {
        config: {
          requirements: { enabled: true, issueTypeIds: ["10001"] },
        },
      },
    });

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(409);
    expect(mockQueueProjectImport).not.toHaveBeenCalled();
  });

  it("returns 409 and enqueues nothing when a mapping already has a cancel requested", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "ip-1",
      syncStatus: "cancel-requested",
      projectIntegration: {
        config: {
          requirements: { enabled: true, issueTypeIds: ["10001"] },
        },
      },
    });

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(409);
    expect(mockQueueProjectImport).not.toHaveBeenCalled();
  });

  it("returns 400 and enqueues nothing when classification is disabled", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "ip-1",
      syncStatus: null,
      projectIntegration: {
        config: { requirements: { enabled: false, issueTypeIds: ["10001"] } },
      },
    });

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(400);
    expect(mockQueueProjectImport).not.toHaveBeenCalled();
  });

  it("returns 400 and enqueues nothing when no requirement types are configured", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "ip-1",
      syncStatus: null,
      projectIntegration: {
        config: { requirements: { enabled: true, issueTypeIds: [] } },
      },
    });

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(400);
    expect(mockQueueProjectImport).not.toHaveBeenCalled();
  });

  it("queues the typed, paged-to-completion import with exactly the configured type ids", async () => {
    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.jobId).toBe("job-123");

    expect(mockQueueProjectImport).toHaveBeenCalledTimes(1);
    expect(mockQueueProjectImport).toHaveBeenCalledWith("user-1", 4, "ip-1", {
      issueTypeIds: ["10001", "10002"],
      pagedToCompletion: true,
    });
  });

  it("returns 500 when the queue fails to accept the job", async () => {
    mockQueueProjectImport.mockResolvedValue(null);

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(500);
  });
});
