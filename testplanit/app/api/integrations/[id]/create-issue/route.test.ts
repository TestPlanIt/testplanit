import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing route handler
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userIntegrationAuth: {
      findFirst: vi.fn(),
    },
    integration: {
      findUnique: vi.fn(),
    },
    repositoryCases: {
      findUnique: vi.fn(),
    },
    testRuns: {
      findUnique: vi.fn(),
    },
    sessions: {
      findUnique: vi.fn(),
    },
    projectAssignment: {
      findUnique: vi.fn(),
    },
    issue: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/integrations/IntegrationManager", () => ({
  IntegrationManager: {
    getInstance: vi.fn(),
  },
}));

import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";

import { POST } from "./route";

const createRequest = (payload: Record<string, any> = {}): NextRequest => {
  return new NextRequest(
    "http://localhost/api/integrations/1/create-issue",
    {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    }
  );
};

const params = { params: Promise.resolve({ id: "1" }) };

const mockSession = {
  user: { id: "user-1", name: "Test User", email: "test@example.com" },
};

const mockAdapter = {
  createIssue: vi.fn(),
  searchUsers: vi.fn(),
};

describe("POST /api/integrations/[id]/create-issue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (IntegrationManager.getInstance as any).mockReturnValue({
      getAdapter: vi.fn().mockResolvedValue(mockAdapter),
    });
    mockAdapter.createIssue.mockResolvedValue({
      id: "ext-123",
      key: "PROJ-1",
      title: "Test Issue",
      url: "https://example.com/issues/PROJ-1",
      status: "Open",
    });
    mockAdapter.searchUsers.mockResolvedValue([]);
  });

  describe("Authentication", () => {
    it("returns 401 when no session", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const response = await POST(createRequest({ title: "Test", projectId: "PROJ" }), params);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user id", async () => {
      (getServerSession as any).mockResolvedValue({ user: {} });

      const response = await POST(createRequest({ title: "Test", projectId: "PROJ" }), params);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 when title is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(createRequest({ projectId: "PROJ" }), params);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });

    it("returns 400 when projectId is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(createRequest({ title: "Test Issue" }), params);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid request data");
    });
  });

  describe("Integration lookup", () => {
    it("returns 404 when integration not found and no user auth", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (prisma.integration.findUnique as any).mockResolvedValue(null);

      const response = await POST(
        createRequest({ title: "Test", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");
    });

    it("returns 401 when OAuth integration requires user auth", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (prisma.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "OAUTH2",
        status: "ACTIVE",
      });

      const response = await POST(
        createRequest({ title: "Test", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.authType).toBe("OAUTH2");
    });
  });

  describe("Successful creation with API_KEY integration", () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (prisma.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        status: "ACTIVE",
        provider: "JIRA",
      });
    });

    it("returns created issue data for API_KEY integration", async () => {
      const response = await POST(
        createRequest({ title: "New Issue", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.key).toBe("PROJ-1");
      expect(data.title).toBe("Test Issue");
    });

    it("calls IntegrationManager.getAdapter with integration id", async () => {
      const mockGetAdapter = vi.fn().mockResolvedValue(mockAdapter);
      (IntegrationManager.getInstance as any).mockReturnValue({
        getAdapter: mockGetAdapter,
      });

      await POST(
        createRequest({ title: "New Issue", projectId: "PROJ" }),
        params
      );

      expect(mockGetAdapter).toHaveBeenCalledWith("1");
    });
  });

  describe("Successful creation with user auth (OAuth)", () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.userIntegrationAuth.findFirst as any).mockResolvedValue({
        id: 10,
        userId: "user-1",
        integrationId: 1,
        isActive: true,
        accessToken: "oauth-token",
        integration: { id: 1, authType: "OAUTH2", status: "ACTIVE" },
      });
    });

    it("creates issue and returns data when user has OAuth auth", async () => {
      const response = await POST(
        createRequest({ title: "OAuth Issue", projectId: "PROJ" }),
        params
      );
      const _data = await response.json();

      expect(response.status).toBe(200);
      expect(mockAdapter.createIssue).toHaveBeenCalledOnce();
    });
  });

  describe("Linking to entities", () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (prisma.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        status: "ACTIVE",
      });
      (prisma.repositoryCases.findUnique as any).mockResolvedValue({
        id: 42,
        projectId: 100,
      });
      (prisma.projectAssignment.findUnique as any).mockResolvedValue({
        userId: "user-1",
        projectId: 100,
      });
      (prisma.issue.upsert as any).mockResolvedValue({
        id: 99,
        externalId: "PROJ-1",
        integrationId: 1,
      });
    });

    it("stores issue in DB when testCaseId provided", async () => {
      const response = await POST(
        createRequest({ title: "Linked Issue", projectId: "PROJ", testCaseId: "42" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(prisma.issue.upsert).toHaveBeenCalledOnce();
      expect(data.internalId).toBe(99);
    });
  });

  describe("Error handling", () => {
    it("returns 500 when adapter createIssue throws", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (prisma.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        status: "ACTIVE",
      });
      mockAdapter.createIssue.mockRejectedValue(new Error("External service error"));

      const response = await POST(
        createRequest({ title: "Failing Issue", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to create issue");
    });

    it("returns 500 when adapter cannot be initialized", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (prisma.userIntegrationAuth.findFirst as any).mockResolvedValue(null);
      (prisma.integration.findUnique as any).mockResolvedValue({
        id: 1,
        authType: "API_KEY",
        status: "ACTIVE",
      });
      (IntegrationManager.getInstance as any).mockReturnValue({
        getAdapter: vi.fn().mockResolvedValue(null),
      });

      const response = await POST(
        createRequest({ title: "No Adapter Issue", projectId: "PROJ" }),
        params
      );
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("adapter");
    });
  });
});
