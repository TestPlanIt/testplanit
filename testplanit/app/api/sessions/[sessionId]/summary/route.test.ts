import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    sessions: {
      findUnique: vi.fn(),
    },
    issue: {
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";

describe("Session Summary API Route", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      access: "USER",
    },
  };

  const mockSessionData = {
    id: 1,
    estimate: 3600,
    issues: [
      {
        id: 10,
        name: "BUG-001",
        title: "Login fails on mobile",
        externalId: "123",
        externalKey: "BUG-001",
        externalUrl: "https://jira.example.com/BUG-001",
        externalStatus: "Open",
        data: null,
        integrationId: 5,
        lastSyncedAt: null,
        integration: {
          id: 5,
          provider: "JIRA",
          name: "Jira Integration",
        },
      },
    ],
  };

  const mockResults = [
    {
      id: 100,
      createdAt: new Date("2024-01-01T10:00:00Z"),
      elapsed: 300,
      statusId: 1,
      statusName: "Passed",
      statusColorValue: "#22c55e",
    },
    {
      id: 101,
      createdAt: new Date("2024-01-01T10:05:00Z"),
      elapsed: 150,
      statusId: 2,
      statusName: "Failed",
      statusColorValue: "#ef4444",
    },
  ];

  const createRequest = (
    sessionId: string = "1"
  ): [NextRequest, { params: Promise<{ sessionId: string }> }] => {
    const request = {} as NextRequest;
    return [request, { params: Promise.resolve({ sessionId }) }];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(mockSession);
    (prisma.sessions.findUnique as any).mockResolvedValue(mockSessionData);
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce(mockResults) // session results
      .mockResolvedValueOnce([]) // issue links
      .mockResolvedValueOnce([{ count: BigInt(3) }]); // comments count
    (prisma.issue.findMany as any).mockResolvedValue([]);
  });

  describe("Authentication", () => {
    it("returns 401 when user is not authenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 for invalid (non-numeric) session ID", async () => {
      const [request, context] = createRequest("not-a-number");
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid session ID");
    });
  });

  describe("Not Found", () => {
    it("returns 404 when session does not exist", async () => {
      (prisma.sessions.findUnique as any).mockResolvedValue(null);

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Session not found");
    });
  });

  describe("Successful GET", () => {
    it("returns SessionSummaryData shape on success", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("sessionId", 1);
      expect(data).toHaveProperty("estimate");
      expect(data).toHaveProperty("totalElapsed");
      expect(data).toHaveProperty("commentsCount");
      expect(data).toHaveProperty("results");
      expect(data).toHaveProperty("sessionIssues");
      expect(data).toHaveProperty("resultIssues");
    });

    it("calculates totalElapsed from all results", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      // 300 + 150 = 450
      expect(data.totalElapsed).toBe(450);
    });

    it("converts comments count BigInt to number", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.commentsCount).toBe(3);
      expect(typeof data.commentsCount).toBe("number");
    });

    it("includes results with status info and issue IDs", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(2);
      expect(data.results[0]).toHaveProperty("id", 100);
      expect(data.results[0]).toHaveProperty("statusName", "Passed");
      expect(data.results[0]).toHaveProperty("issueIds");
      expect(Array.isArray(data.results[0].issueIds)).toBe(true);
    });

    it("includes session issues in response", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.sessionIssues).toHaveLength(1);
      expect(data.sessionIssues[0].name).toBe("BUG-001");
    });

    it("links result issues when results have issue associations", async () => {
      // Reset mocks to provide issue link data
      (prisma.$queryRaw as any)
        .mockReset()
        .mockResolvedValueOnce(mockResults)
        .mockResolvedValueOnce([{ sessionResultId: 100, issueId: 20 }]) // issue link
        .mockResolvedValueOnce([{ count: BigInt(0) }]); // comments count

      const mockIssue = {
        id: 20,
        name: "BUG-002",
        title: "Another bug",
        externalId: null,
        externalKey: null,
        externalUrl: null,
        externalStatus: null,
        data: null,
        integrationId: null,
        lastSyncedAt: null,
        integration: null,
      };
      (prisma.issue.findMany as any).mockResolvedValue([mockIssue]);

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.resultIssues).toHaveLength(1);
      expect(data.resultIssues[0].id).toBe(20);
      // The result with id 100 should have issueId 20 linked
      const result100 = data.results.find((r: any) => r.id === 100);
      expect(result100.issueIds).toContain(20);
    });

    it("returns estimate from session", async () => {
      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.estimate).toBe(3600);
    });

    it("handles session with no results gracefully", async () => {
      (prisma.$queryRaw as any)
        .mockReset()
        .mockResolvedValueOnce([]) // no results
        .mockResolvedValueOnce([{ count: BigInt(0) }]); // comments count

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.results).toHaveLength(0);
      expect(data.totalElapsed).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when database query fails", async () => {
      (prisma.sessions.findUnique as any).mockRejectedValue(
        new Error("DB Error")
      );

      const [request, context] = createRequest();
      const response = await GET(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch session summary");
    });
  });
});
