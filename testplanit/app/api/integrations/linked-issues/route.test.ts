import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the route handler.
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(),
}));

vi.mock("@/lib/integrations/IntegrationManager", () => ({
  IntegrationManager: {
    getInstance: vi.fn(),
  },
}));

import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { getEnhancedDb } from "@/lib/auth/utils";
import { getServerSession } from "next-auth";

import { GET } from "./route";

const buildRequest = (qs: string): NextRequest => {
  const url = new URL(`http://localhost/api/integrations/linked-issues?${qs}`);
  return new NextRequest(url.toString());
};

const mockSession = {
  user: { id: "user-1", name: "Test User", email: "test@example.com" },
};

const mockDb = {
  projectIntegration: {
    findFirst: vi.fn(),
  },
};

const mockGetAdapter = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (getEnhancedDb as any).mockResolvedValue(mockDb);
  (IntegrationManager.getInstance as any).mockReturnValue({
    getAdapter: mockGetAdapter,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/integrations/linked-issues", () => {
  it("returns 401 when there is no session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const response = await GET(buildRequest("projectId=42&issueKey=PROJ-1"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 when projectId is missing", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);

    const response = await GET(buildRequest("issueKey=PROJ-1"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(String(data.error)).toMatch(/projectId/i);
  });

  it("returns 400 when issueKey is missing", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);

    const response = await GET(buildRequest("projectId=42"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(String(data.error)).toMatch(/issueKey/i);
  });

  it("returns 400 when projectId is non-numeric", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);

    const response = await GET(buildRequest("projectId=foo&issueKey=PROJ-1"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(String(data.error)).toMatch(/projectId/i);
  });

  it("returns 404 when no active issue integration exists for the project", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mockDb.projectIntegration.findFirst.mockResolvedValue(null);

    const response = await GET(buildRequest("projectId=42&issueKey=PROJ-1"));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(String(data.error)).toMatch(/integration/i);
  });

  it("returns 404 when IntegrationManager.getAdapter returns null", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mockDb.projectIntegration.findFirst.mockResolvedValue({
      id: "pi-cuid",
      projectId: 42,
      integrationId: 7,
      isActive: true,
    });
    mockGetAdapter.mockResolvedValue(null);

    const response = await GET(buildRequest("projectId=42&issueKey=PROJ-1"));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(String(data.error)).toMatch(/adapter/i);
  });

  it("returns 200 with refs on the happy path", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mockDb.projectIntegration.findFirst.mockResolvedValue({
      id: "pi-cuid",
      projectId: 42,
      integrationId: 7,
      isActive: true,
    });
    const getLinkedIssues = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "200", key: "PROJ-2", linkType: "blocks", direction: "outward" },
      ]);
    mockGetAdapter.mockResolvedValue({ getLinkedIssues });

    const response = await GET(buildRequest("projectId=42&issueKey=PROJ-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      refs: [
        { id: "200", key: "PROJ-2", linkType: "blocks", direction: "outward" },
      ],
    });
    expect(getLinkedIssues).toHaveBeenCalledTimes(1);
    expect(getLinkedIssues).toHaveBeenCalledWith("PROJ-1");
    expect(mockGetAdapter).toHaveBeenCalledWith("7");
  });

  it("returns 200 with empty refs when adapter does not implement getLinkedIssues", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mockDb.projectIntegration.findFirst.mockResolvedValue({
      id: "pi-cuid",
      projectId: 42,
      integrationId: 7,
      isActive: true,
    });
    mockGetAdapter.mockResolvedValue({});

    const response = await GET(buildRequest("projectId=42&issueKey=PROJ-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ refs: [] });
  });

  it("returns 200 fail-soft with empty refs when adapter.getLinkedIssues throws", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    mockDb.projectIntegration.findFirst.mockResolvedValue({
      id: "pi-cuid",
      projectId: 42,
      integrationId: 7,
      isActive: true,
    });
    const getLinkedIssues = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream boom"));
    mockGetAdapter.mockResolvedValue({ getLinkedIssues });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await GET(buildRequest("projectId=42&issueKey=PROJ-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ refs: [] });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
