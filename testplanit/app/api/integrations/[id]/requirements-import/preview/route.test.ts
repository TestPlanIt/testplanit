import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the route handler.
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  baseDb: {
    integrationProject: { findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: vi.fn(),
}));

const { mockGetEnhancedDb, mockPreviewProjectImport } = vi.hoisted(() => ({
  mockGetEnhancedDb: vi.fn(),
  mockPreviewProjectImport: vi.fn(),
}));

vi.mock("@/lib/auth/utils", () => ({
  getEnhancedDb: mockGetEnhancedDb,
}));

vi.mock("@/lib/integrations/services/SyncService", () => ({
  syncService: { previewProjectImport: mockPreviewProjectImport },
}));

import { baseDb } from "@/lib/db";
import { getEnhancedDb } from "@/lib/auth/utils";
import { syncService } from "@/lib/integrations/services/SyncService";
import { getServerSession } from "next-auth";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedFindFirst = baseDb.integrationProject
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedAuth = authorizeProjectAdminForProject as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetEnhancedDb = getEnhancedDb as unknown as ReturnType<
  typeof vi.fn
>;
const mockedPreview = syncService.previewProjectImport as unknown as ReturnType<
  typeof vi.fn
>;

const params = { params: Promise.resolve({ id: "4" }) };

function makeRequest(body?: unknown, rawBody?: string): NextRequest {
  return new NextRequest(
    "http://localhost/api/integrations/4/requirements-import/preview",
    {
      method: "POST",
      body: rawBody !== undefined ? rawBody : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("POST /api/integrations/[id]/requirements-import/preview", () => {
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
    mockedGetEnhancedDb.mockResolvedValue({ marker: "enhanced-db" });
    mockedPreview.mockResolvedValue({ matched: 7, hasMore: false, cap: 200 });
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
    expect(mockedPreview).not.toHaveBeenCalled();
  });

  it("returns 400 when the integration id is not numeric", async () => {
    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      { params: Promise.resolve({ id: "abc" }) }
    );

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed JSON body", async () => {
    const res = await POST(makeRequest(undefined, "{not json"), params);

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
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
    expect(mockedPreview).not.toHaveBeenCalled();
  });

  it("returns 404 when the mapping does not belong to the caller's authorized project (cross-project aim)", async () => {
    // The admin check passes for project 42 (the caller genuinely admins
    // it), but the addressed mapping actually belongs to a different
    // project — the bound findFirst (projectId 42 + integrationId 4 in the
    // where clause) can never find it, so it resolves null exactly as an
    // unknown mapping id would.
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
    expect(mockedPreview).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown mapping id", async () => {
    mockedFindFirst.mockResolvedValue(null);

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "does-not-exist" }),
      params
    );

    expect(res.status).toBe(404);
    expect(mockedPreview).not.toHaveBeenCalled();
  });

  it("short-circuits with enabled:false and makes no adapter call when classification is disabled", async () => {
    mockedFindFirst.mockResolvedValue({
      id: "ip-1",
      syncStatus: null,
      projectIntegration: {
        config: {
          requirements: { enabled: false, issueTypeIds: ["10001"] },
        },
      },
    });

    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ matched: 0, hasMore: false, enabled: false });
    expect(mockedPreview).not.toHaveBeenCalled();
    expect(mockedGetEnhancedDb).not.toHaveBeenCalled();
  });

  it("short-circuits with enabled:false and makes no adapter call when no types are configured", async () => {
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

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ matched: 0, hasMore: false, enabled: false });
    expect(mockedPreview).not.toHaveBeenCalled();
  });

  it("calls previewProjectImport with exactly the configured type ids and no recency window, returning its result", async () => {
    const res = await POST(
      makeRequest({ projectId: 42, integrationProjectId: "ip-1" }),
      params
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ matched: 7, hasMore: false, cap: 200 });

    expect(mockedPreview).toHaveBeenCalledTimes(1);
    expect(mockedPreview).toHaveBeenCalledWith(
      4,
      "ip-1",
      { issueTypeIds: ["10001", "10002"] },
      { dbClient: { marker: "enhanced-db" } }
    );
    const optionsArg = mockedPreview.mock.calls[0][2];
    expect(optionsArg).not.toHaveProperty("updatedWithinDays");
  });
});
