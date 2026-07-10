import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    milestones: {
      findUnique: vi.fn(),
    },
    comment: {
      count: vi.fn(),
    },
    issue: {
      findMany: vi.fn(),
    },
    milestoneIssue: {
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

const mockGetVisibleMilestone = vi.fn();
vi.mock("~/lib/services/milestoneAccess", () => ({
  getVisibleMilestone: (...args: any[]) => mockGetVisibleMilestone(...args),
}));

vi.mock("~/lib/services/milestoneDescendants", () => ({
  getAllDescendantMilestoneIds: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import { GET } from "./route";

const createRequest = (
  milestoneId: string
): [NextRequest, { params: Promise<{ milestoneId: string }> }] => {
  const req = new NextRequest(
    `http://localhost/api/milestones/${milestoneId}/summary`
  );
  const params = { params: Promise.resolve({ milestoneId }) };
  return [req, params];
};

const mockSession = {
  user: { id: "user-1", name: "Test User" },
};

const mockMilestone = {
  id: 1,
  projectId: 10,
};

describe("GET /api/milestones/[milestoneId]/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAllDescendantMilestoneIds as any).mockResolvedValue([]);
    // $queryRaw is called multiple times: getTestRunSegments, getSessionSegments, calculateMilestoneCompletion
    // and for issue joins (_IssueToTestRuns, _IssueToSessions, _IssueToSessionResults)
    (baseDb.$queryRaw as any).mockResolvedValue([]);
    (baseDb.comment.count as any).mockResolvedValue(0);
    (baseDb.issue.findMany as any).mockResolvedValue([]);
    (baseDb.milestoneIssue.count as any).mockResolvedValue(0);
  });

  describe("Input validation", () => {
    it("returns 400 for non-numeric milestoneId", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const [req, ctx] = createRequest("not-a-number");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid milestone ID");
    });
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when session has no user", async () => {
      (getServerSession as any).mockResolvedValue({});

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Milestone existence", () => {
    it("returns 404 when milestone does not exist", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockGetVisibleMilestone.mockResolvedValue(null);

      const [req, ctx] = createRequest("999");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Milestone not found");
    });
  });

  describe("Success", () => {
    it("returns MilestoneSummaryData structure for existing milestone", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockGetVisibleMilestone.mockResolvedValue(mockMilestone);
      (baseDb.comment.count as any).mockResolvedValue(3);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("milestoneId", 1);
      expect(data).toHaveProperty("totalItems");
      expect(data).toHaveProperty("completionRate");
      expect(data).toHaveProperty("totalElapsed");
      expect(data).toHaveProperty("totalEstimate");
      expect(data).toHaveProperty("commentsCount", 3);
      expect(data).toHaveProperty("segments");
      expect(data).toHaveProperty("issues");
      expect(data).toHaveProperty("scopeCount");
      expect(Array.isArray(data.segments)).toBe(true);
      expect(Array.isArray(data.issues)).toBe(true);
    });

    it("returns scopeCount scoped to THIS milestone only (D-15, not allMilestoneIds)", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockGetVisibleMilestone.mockResolvedValue(mockMilestone);
      (getAllDescendantMilestoneIds as any).mockResolvedValue([2, 3]);
      (baseDb.milestoneIssue.count as any).mockResolvedValue(12);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.scopeCount).toBe(12);
      expect(baseDb.milestoneIssue.count).toHaveBeenCalledWith({
        where: { milestoneId: 1 },
      });
    });

    it("fetches descendants and includes them in queries", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockGetVisibleMilestone.mockResolvedValue(mockMilestone);
      (getAllDescendantMilestoneIds as any).mockResolvedValue([2, 3]);
      (baseDb.comment.count as any).mockResolvedValue(0);

      const [req, ctx] = createRequest("1");
      await GET(req, ctx);

      expect(getAllDescendantMilestoneIds).toHaveBeenCalledWith(1);
    });

    it("returns zero completion rate when no test cases", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockGetVisibleMilestone.mockResolvedValue(mockMilestone);
      // calculateMilestoneCompletion uses $queryRaw returning count=0
      (baseDb.$queryRaw as any).mockResolvedValue([{ count: BigInt(0) }]);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.completionRate).toBe(0);
    });

    it("returns empty segments and issues when milestone has no runs or sessions", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockGetVisibleMilestone.mockResolvedValue(mockMilestone);
      (baseDb.$queryRaw as any).mockResolvedValue([]);
      (baseDb.comment.count as any).mockResolvedValue(0);
      (baseDb.issue.findMany as any).mockResolvedValue([]);

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.segments).toEqual([]);
      expect(data.issues).toEqual([]);
      expect(data.totalItems).toBe(0);
    });
  });

  describe("Error handling", () => {
    it("returns 500 when database throws", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      mockGetVisibleMilestone.mockRejectedValue(
        new Error("DB connection failed")
      );

      const [req, ctx] = createRequest("1");
      const response = await GET(req, ctx);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch milestone summary");
    });
  });
});
