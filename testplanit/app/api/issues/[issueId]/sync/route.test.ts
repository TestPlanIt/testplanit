import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted() for variables referenced in vi.mock() factory functions
const { mockFindUnique, mockQueueIssueRefresh, mockPerformIssueRefresh } =
  vi.hoisted(() => ({
    mockFindUnique: vi.fn(),
    mockQueueIssueRefresh: vi.fn(),
    mockPerformIssueRefresh: vi.fn(),
  }));

// Mock dependencies before importing route handler
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    issue: {
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock("@/lib/integrations/services/SyncService", () => ({
  syncService: {
    queueIssueRefresh: mockQueueIssueRefresh,
    performIssueRefresh: mockPerformIssueRefresh,
  },
}));

import { getServerSession } from "next-auth";

import { POST } from "./route";

const createRequest = (): NextRequest => {
  return new NextRequest(
    "http://localhost/api/issues/1/sync",
    { method: "POST" }
  );
};

const params = (issueId: string = "1") => ({
  params: Promise.resolve({ issueId }),
});

const mockSession = {
  user: { id: "user-1", name: "Test User" },
};

const mockIssue = {
  id: 1,
  externalId: "PROJ-42",
  integrationId: 10,
  integration: {
    id: 10,
    name: "JIRA",
    provider: "JIRA",
  },
};

const mockUpdatedIssue = {
  id: 1,
  externalId: "PROJ-42",
  integrationId: 10,
  integration: {
    id: 10,
    name: "JIRA",
    provider: "JIRA",
  },
  project: {
    id: 100,
    name: "My Project",
    iconUrl: null,
  },
};

describe("POST /api/issues/[issueId]/sync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default happy path: first call returns issue, second returns updated issue
    mockFindUnique
      .mockResolvedValueOnce(mockIssue)
      .mockResolvedValueOnce(mockUpdatedIssue);
    mockQueueIssueRefresh.mockResolvedValue("job-abc");
    mockPerformIssueRefresh.mockResolvedValue({ success: true });
  });

  describe("Authentication", () => {
    it("returns 401 when no session", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user id", async () => {
      (getServerSession as any).mockResolvedValue({ user: {} });

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Issue lookup", () => {
    it("returns 404 when issue not found in DB", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockFindUnique.mockReset();
      mockFindUnique.mockResolvedValue(null);

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Issue not found");
    });

    it("returns 400 when issue has no externalId", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockFindUnique.mockReset();
      mockFindUnique.mockResolvedValue({
        ...mockIssue,
        externalId: null,
      });

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("external");
    });

    it("returns 400 when issue has no integrationId", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockFindUnique.mockReset();
      mockFindUnique.mockResolvedValue({
        ...mockIssue,
        integrationId: null,
        externalId: "PROJ-42",
      });

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("external");
    });

    it("returns 404 when issue's integration record is null", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockFindUnique.mockReset();
      mockFindUnique.mockResolvedValue({
        ...mockIssue,
        integration: null,
      });

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Integration not found");
    });
  });

  describe("Successful sync", () => {
    it("returns success with updated issue data", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Issue synced successfully");
      expect(data.issue).toBeDefined();
    });

    it("calls syncService.queueIssueRefresh with correct params", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      await POST(createRequest(), params("1"));

      expect(mockQueueIssueRefresh).toHaveBeenCalledWith(
        "user-1",
        10,
        "PROJ-42"
      );
    });

    it("calls syncService.performIssueRefresh with correct params", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      await POST(createRequest(), params("1"));

      expect(mockPerformIssueRefresh).toHaveBeenCalledWith(
        "user-1",
        10,
        "PROJ-42"
      );
    });

    it("fetches updated issue after successful sync", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(mockFindUnique).toHaveBeenCalledTimes(2);
      expect(data.issue.project).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("returns 500 when syncService queue fails (no job id)", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockQueueIssueRefresh.mockResolvedValue(null);

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Failed to queue sync job");
    });

    it("returns 500 when syncService.performIssueRefresh fails", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockPerformIssueRefresh.mockResolvedValue({
        success: false,
        error: "External service unavailable",
      });

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("External service unavailable");
    });

    it("returns 500 when unexpected exception thrown during DB fetch", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockFindUnique.mockReset();
      mockFindUnique.mockRejectedValue(new Error("Database connection error"));

      const response = await POST(createRequest(), params());
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain("Database connection error");
    });
  });

  describe("Input validation", () => {
    it("returns 400 when issueId param is not a number", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(createRequest(), params("not-a-number"));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid issue ID");
    });
  });
});
