import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing route handler
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

const createRequest = (query?: string, projectId?: string): NextRequest => {
  const url = new URL("http://localhost/api/integrations/1/search");
  if (query) url.searchParams.set("q", query);
  if (projectId) url.searchParams.set("projectId", projectId);
  return new NextRequest(url.toString());
};

const params = { params: Promise.resolve({ id: "1" }) };

const mockSession = {
  user: { id: "user-1", name: "Test User", email: "test@example.com" },
};

const mockAdapter = {
  searchIssues: vi.fn(),
  getAuthorizationUrl: vi.fn(),
  setAccessToken: vi.fn(),
};

const mockDb = {
  integration: {
    findUnique: vi.fn(),
  },
};

describe("GET /api/integrations/[id]/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getEnhancedDb as any).mockResolvedValue(mockDb);
    (IntegrationManager.getInstance as any).mockReturnValue({
      getAdapter: vi.fn().mockResolvedValue(mockAdapter),
    });
    mockAdapter.searchIssues.mockResolvedValue({
      issues: [{ id: "1", title: "Test Issue" }],
      total: 1,
    });
    mockAdapter.getAuthorizationUrl.mockResolvedValue("https://auth.example.com/oauth");
  });

  describe("Authentication", () => {
    it("returns 401 when no session", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 when query param q is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await GET(createRequest(), params);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("required");
    });
  });

  describe("Integration lookup", () => {
    it("returns 404 when integration not found", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockDb.integration.findUnique.mockResolvedValue(null);

      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");
    });

    it("returns 401 when API_KEY integration has no credentials", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockDb.integration.findUnique.mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        credentials: null,
        userIntegrationAuths: [],
      });

      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.requiresAuth).toBe(true);
    });

    it("returns 401 with authUrl when OAuth integration has no user auth", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockDb.integration.findUnique.mockResolvedValue({
        id: 1,
        authType: "OAUTH2",
        credentials: null,
        userIntegrationAuths: [],
      });

      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.requiresAuth).toBe(true);
      expect(data.authUrl).toBe("https://auth.example.com/oauth");
    });
  });

  describe("Successful search with API_KEY integration", () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockDb.integration.findUnique.mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        credentials: { apiToken: "secret-key" },
        userIntegrationAuths: [],
      });
    });

    it("returns issues array and total for API_KEY integration", async () => {
      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.issues).toHaveLength(1);
      expect(data.total).toBe(1);
    });

    it("passes query to adapter.searchIssues", async () => {
      await GET(createRequest("my-query"), params);

      expect(mockAdapter.searchIssues).toHaveBeenCalledWith(
        expect.objectContaining({ query: "my-query" })
      );
    });

    it("includes projectId in search options when provided", async () => {
      await GET(createRequest("test", "PROJ-1"), params);

      expect(mockAdapter.searchIssues).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "PROJ-1" })
      );
    });

    it("handles array return from adapter", async () => {
      mockAdapter.searchIssues.mockResolvedValue([
        { id: "1", title: "Issue A" },
        { id: "2", title: "Issue B" },
      ]);

      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.issues).toHaveLength(2);
      expect(data.total).toBe(2);
    });
  });

  describe("Successful search with PAT integration", () => {
    it("returns search results for PERSONAL_ACCESS_TOKEN integration", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockDb.integration.findUnique.mockResolvedValue({
        id: 1,
        authType: "PERSONAL_ACCESS_TOKEN",
        credentials: { personalAccessToken: "pat-token" },
        userIntegrationAuths: [],
      });

      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.issues).toBeDefined();
    });
  });

  describe("Successful search with OAuth integration", () => {
    it("returns search results when user has valid OAuth token", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockDb.integration.findUnique.mockResolvedValue({
        id: 1,
        authType: "OAUTH2",
        credentials: null,
        userIntegrationAuths: [
          { userId: "user-1", accessToken: "oauth-token", isActive: true },
        ],
      });

      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.issues).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("returns 500 when adapter.searchIssues throws generic error", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockDb.integration.findUnique.mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        credentials: { apiToken: "key" },
        userIntegrationAuths: [],
      });
      mockAdapter.searchIssues.mockRejectedValue(new Error("External search failed"));

      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("External search failed");
    });

    it("returns 401 with authUrl when adapter throws 401 error on OAuth integration", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockDb.integration.findUnique.mockResolvedValue({
        id: 1,
        authType: "OAUTH2",
        credentials: null,
        userIntegrationAuths: [
          { userId: "user-1", accessToken: "expired-token", isActive: true },
        ],
      });
      mockAdapter.searchIssues.mockRejectedValue(new Error("401 Unauthorized"));

      const response = await GET(createRequest("test"), params);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.requiresAuth).toBe(true);
    });
  });
});
