import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    repositoryCases: {
      count: vi.fn(),
    },
    sessions: {
      count: vi.fn(),
    },
    sessionResults: {
      groupBy: vi.fn(),
    },
    testRuns: {
      count: vi.fn(),
    },
    testRunResults: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    testRunStepResults: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@prisma/client", () => ({
  ProjectAccessType: {
    NO_ACCESS: "NO_ACCESS",
    VIEW: "VIEW",
    EDIT: "EDIT",
    GLOBAL_ROLE: "GLOBAL_ROLE",
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "~/lib/prisma";

import { POST } from "./route";

const createMockRequest = (body: any): Request => {
  return {
    json: async () => body,
  } as unknown as Request;
};

const mockAdminSession = {
  user: {
    id: "admin-1",
    name: "Admin User",
    access: "ADMIN",
  },
};

const mockUserSession = {
  user: {
    id: "user-1",
    name: "Regular User",
    access: "USER",
  },
};

describe("Issues Counts Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.repositoryCases.count as any).mockResolvedValue(0);
    (prisma.sessions.count as any).mockResolvedValue(0);
    (prisma.sessionResults.groupBy as any).mockResolvedValue([]);
    (prisma.testRuns.count as any).mockResolvedValue(0);
    (prisma.testRunResults.groupBy as any).mockResolvedValue([]);
    (prisma.testRunStepResults.findMany as any).mockResolvedValue([]);
    (prisma.testRunResults.findMany as any).mockResolvedValue([]);
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const request = createMockRequest({ issueIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user id", async () => {
      (getServerSession as any).mockResolvedValue({ user: {} });

      const request = createMockRequest({ issueIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns empty counts when issueIds is empty array", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({});
    });

    it("returns empty counts when issueIds is not an array", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: "not-an-array" });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({});
    });

    it("returns empty counts when issueIds is null", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: null });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts).toEqual({});
    });
  });

  describe("POST - issue count aggregation", () => {
    it("returns counts with repositoryCases, sessions, testRuns for each issue", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (prisma.repositoryCases.count as any).mockResolvedValue(3);
      (prisma.sessions.count as any).mockResolvedValue(2);
      (prisma.sessionResults.groupBy as any).mockResolvedValue([{ sessionId: 1 }]);
      (prisma.testRuns.count as any).mockResolvedValue(1);
      (prisma.testRunResults.groupBy as any).mockResolvedValue([]);
      (prisma.testRunStepResults.findMany as any).mockResolvedValue([]);

      const request = createMockRequest({ issueIds: [10] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[10]).toEqual({
        repositoryCases: 3,
        sessions: 3, // 2 direct + 1 from sessionResults
        testRuns: 1,
      });
    });

    it("returns counts for multiple issueIds", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      // Issue 1
      (prisma.repositoryCases.count as any)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2);
      (prisma.sessions.count as any)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0);
      (prisma.sessionResults.groupBy as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      (prisma.testRuns.count as any)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(1);
      (prisma.testRunResults.groupBy as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      (prisma.testRunStepResults.findMany as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const request = createMockRequest({ issueIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[1]).toEqual({ repositoryCases: 5, sessions: 1, testRuns: 3 });
      expect(data.counts[2]).toEqual({ repositoryCases: 2, sessions: 0, testRuns: 1 });
    });

    it("filters by issueId when counting entities", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [42] });
      await POST(request);

      expect(prisma.repositoryCases.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            issues: { some: { id: 42 } },
          }),
        })
      );
    });

    it("filters out deleted items", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [1] });
      await POST(request);

      expect(prisma.repositoryCases.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isDeleted: false }),
        })
      );
      expect(prisma.testRuns.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isDeleted: false }),
        })
      );
    });

    it("applies projectId scope when provided", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [1], projectId: 99 });
      await POST(request);

      expect(prisma.repositoryCases.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: 99 }),
        })
      );
    });

    it("does not add projectId filter when projectId not provided", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [1] });
      await POST(request);

      const callArg = (prisma.repositoryCases.count as any).mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty("projectId");
    });

    it("combines test run counts from testRunResults groupBy", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (prisma.testRuns.count as any).mockResolvedValue(1);
      (prisma.testRunResults.groupBy as any).mockResolvedValue([
        { testRunId: 10 },
        { testRunId: 11 },
      ]);
      (prisma.testRunStepResults.findMany as any).mockResolvedValue([]);

      const request = createMockRequest({ issueIds: [5] });
      const response = await POST(request);
      const data = await response.json();

      // 1 direct + 2 from testRunResults
      expect(data.counts[5].testRuns).toBe(3);
    });

    it("fetches test runs from step results when step results have testRunResultIds", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (prisma.testRunStepResults.findMany as any).mockResolvedValue([
        { testRunResultId: 100 },
        { testRunResultId: 101 },
      ]);
      (prisma.testRunResults.findMany as any).mockResolvedValue([
        { testRunId: 200 },
      ]);

      const request = createMockRequest({ issueIds: [7] });
      const response = await POST(request);
      const data = await response.json();

      expect(prisma.testRunResults.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [100, 101] } },
        })
      );
      // 0 direct + 0 from groupBy + 1 from step results
      expect(data.counts[7].testRuns).toBe(1);
    });
  });

  describe("Project access filtering", () => {
    it("does not add project access filter for ADMIN users", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [1] });
      await POST(request);

      const callArg = (prisma.repositoryCases.count as any).mock.calls[0][0];
      expect(callArg.where).not.toHaveProperty("project");
    });

    it("adds project access filter for non-admin users", async () => {
      (getServerSession as any).mockResolvedValue(mockUserSession);

      const request = createMockRequest({ issueIds: [1] });
      await POST(request);

      const callArg = (prisma.repositoryCases.count as any).mock.calls[0][0];
      expect(callArg.where).toHaveProperty("project");
    });
  });

  describe("Error handling", () => {
    it("returns 500 when database query fails", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (prisma.repositoryCases.count as any).mockRejectedValue(new Error("DB error"));

      const request = createMockRequest({ issueIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch counts");
    });

    it("handles malformed request body gracefully", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      const request = {
        json: async () => { throw new Error("Invalid JSON"); },
      } as unknown as Request;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch counts");
    });
  });

  describe("Response format", () => {
    it("returns counts object with correct structure", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("counts");
      expect(typeof data.counts).toBe("object");
      expect(Array.isArray(data.counts)).toBe(false);
    });

    it("uses issueId as key in the response", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [99] });
      const response = await POST(request);
      const data = await response.json();

      expect(data.counts).toHaveProperty("99");
    });
  });
});
