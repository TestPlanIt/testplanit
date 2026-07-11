import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

// The route drives the counts from a single issue-side `issue.findMany` that
// hydrates each issue's linked caseIssues / sessions / sessionResults /
// testRuns / testRunResults / testRunStepResults (filtered by the nested
// `where`); counts are derived in memory (lengths + distinct sets).
vi.mock("~/lib/db", () => ({
  baseDb: {
    issue: {
      findMany: vi.fn(),
    },
  },
}));

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";

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

// Build an issue row shaped like the route's `select`. `sessions` reach the
// total additively (direct length + distinct sessionResults.sessionId);
// `testRuns` add direct length + distinct testRunResults.testRunId + distinct
// testRunStepResults.testRunResult.testRunId.
const issueRow = (
  id: number,
  {
    caseIssues = 0,
    sessions = 0,
    sessionResults = [],
    testRuns = 0,
    testRunResults = [],
    testRunStepResults = [],
    milestoneIssues = 0,
  }: {
    caseIssues?: number;
    sessions?: number;
    sessionResults?: Array<{ sessionId: number }>;
    testRuns?: number;
    testRunResults?: Array<{ testRunId: number }>;
    testRunStepResults?: Array<{ testRunResult: { testRunId: number } | null }>;
    milestoneIssues?: number;
  } = {}
) => ({
  id,
  caseIssues: Array.from({ length: caseIssues }, (_, i) => ({ caseId: i })),
  sessions: Array.from({ length: sessions }, (_, i) => ({ id: i })),
  sessionResults,
  testRuns: Array.from({ length: testRuns }, (_, i) => ({ id: i })),
  testRunResults,
  testRunStepResults,
  milestoneIssues: Array.from({ length: milestoneIssues }, (_, i) => ({
    milestoneId: i,
  })),
});

const findManyArg = () => (baseDb.issue.findMany as any).mock.calls[0][0];

describe("Issues Counts Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (baseDb.issue.findMany as any).mockResolvedValue([]);
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
      (baseDb.issue.findMany as any).mockResolvedValue([
        issueRow(10, {
          caseIssues: 3,
          sessions: 2,
          sessionResults: [{ sessionId: 1 }],
          testRuns: 1,
        }),
      ]);

      const request = createMockRequest({ issueIds: [10] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[10]).toEqual({
        repositoryCases: 3,
        sessions: 3, // 2 direct + 1 from sessionResults
        testRuns: 1,
        milestones: 0,
      });
    });

    it("returns counts for multiple issueIds", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (baseDb.issue.findMany as any).mockResolvedValue([
        issueRow(1, { caseIssues: 5, sessions: 1, testRuns: 3 }),
        issueRow(2, { caseIssues: 2, sessions: 0, testRuns: 1 }),
      ]);

      const request = createMockRequest({ issueIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.counts[1]).toEqual({
        repositoryCases: 5,
        sessions: 1,
        testRuns: 3,
        milestones: 0,
      });
      expect(data.counts[2]).toEqual({
        repositoryCases: 2,
        sessions: 0,
        testRuns: 1,
        milestones: 0,
      });
    });

    it("returns zero counts for requested issueIds with no links", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      // Issue 2 isn't returned by findMany (not found / no links).
      (baseDb.issue.findMany as any).mockResolvedValue([
        issueRow(1, { caseIssues: 3 }),
      ]);

      const request = createMockRequest({ issueIds: [1, 2] });
      const response = await POST(request);
      const data = await response.json();

      expect(data.counts[2]).toEqual({
        repositoryCases: 0,
        sessions: 0,
        testRuns: 0,
        milestones: 0,
      });
    });

    it("queries issues by the requested ids", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [42] });
      await POST(request);

      expect(findManyArg().where).toEqual({ id: { in: [42] } });
    });

    it("filters out deleted items in every linked relation", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [1] });
      await POST(request);

      const { select } = findManyArg();
      expect(select.caseIssues.where.case.isDeleted).toBe(false);
      expect(select.sessions.where.isDeleted).toBe(false);
      expect(select.sessionResults.where.session.isDeleted).toBe(false);
      expect(select.testRuns.where.isDeleted).toBe(false);
      expect(select.testRunResults.where.testRun.isDeleted).toBe(false);
      expect(
        select.testRunStepResults.where.testRunResult.testRun.isDeleted
      ).toBe(false);
      expect(select.milestoneIssues.where.milestone.isDeleted).toBe(false);
    });

    it("applies projectId scope when provided", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [1], projectId: 99 });
      await POST(request);

      const { select } = findManyArg();
      expect(select.caseIssues.where.case.projectId).toBe(99);
      expect(select.sessions.where.projectId).toBe(99);
      expect(select.testRuns.where.projectId).toBe(99);
      expect(select.milestoneIssues.where.milestone.projectId).toBe(99);
    });

    it("does not add projectId filter when projectId not provided", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [1] });
      await POST(request);

      const { select } = findManyArg();
      expect(select.caseIssues.where.case).not.toHaveProperty("projectId");
      expect(select.testRuns.where).not.toHaveProperty("projectId");
    });

    it("adds test runs reached via testRunResults", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (baseDb.issue.findMany as any).mockResolvedValue([
        issueRow(5, {
          testRuns: 1,
          testRunResults: [{ testRunId: 10 }, { testRunId: 11 }],
        }),
      ]);

      const request = createMockRequest({ issueIds: [5] });
      const response = await POST(request);
      const data = await response.json();

      // 1 direct + 2 distinct from testRunResults
      expect(data.counts[5].testRuns).toBe(3);
    });

    it("adds test runs reached via testRunStepResults (ignoring null links)", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (baseDb.issue.findMany as any).mockResolvedValue([
        issueRow(7, {
          testRunStepResults: [
            { testRunResult: { testRunId: 200 } },
            { testRunResult: null },
          ],
        }),
      ]);

      const request = createMockRequest({ issueIds: [7] });
      const response = await POST(request);
      const data = await response.json();

      // 0 direct + 0 from testRunResults + 1 distinct from step results
      expect(data.counts[7].testRuns).toBe(1);
    });

    it("counts the milestones an issue is a member of", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (baseDb.issue.findMany as any).mockResolvedValue([
        issueRow(8, { milestoneIssues: 4 }),
      ]);

      const request = createMockRequest({ issueIds: [8] });
      const response = await POST(request);
      const data = await response.json();

      expect(data.counts[8].milestones).toBe(4);
    });
  });

  describe("Project access filtering", () => {
    it("does not add project access filter for ADMIN users", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const request = createMockRequest({ issueIds: [1] });
      await POST(request);

      const { select } = findManyArg();
      expect(select.caseIssues.where.case).not.toHaveProperty("project");
      expect(select.testRuns.where).not.toHaveProperty("project");
      expect(select.milestoneIssues.where.milestone).not.toHaveProperty(
        "project"
      );
    });

    it("adds project access filter for non-admin users", async () => {
      (getServerSession as any).mockResolvedValue(mockUserSession);

      const request = createMockRequest({ issueIds: [1] });
      await POST(request);

      const { select } = findManyArg();
      expect(select.caseIssues.where.case).toHaveProperty("project");
      expect(select.testRuns.where).toHaveProperty("project");
      expect(select.milestoneIssues.where.milestone).toHaveProperty("project");
    });
  });

  describe("Error handling", () => {
    it("returns 500 when database query fails", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      (baseDb.issue.findMany as any).mockRejectedValue(new Error("DB error"));

      const request = createMockRequest({ issueIds: [1] });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch counts");
    });

    it("handles malformed request body gracefully", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);
      const request = {
        json: async () => {
          throw new Error("Invalid JSON");
        },
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
      (baseDb.issue.findMany as any).mockResolvedValue([issueRow(99)]);

      const request = createMockRequest({ issueIds: [99] });
      const response = await POST(request);
      const data = await response.json();

      expect(data.counts).toHaveProperty("99");
    });
  });
});
