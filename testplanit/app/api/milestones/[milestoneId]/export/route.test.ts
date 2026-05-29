import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    milestones: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    reviewRequest: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/milestoneDescendants", () => ({
  getAllDescendantMilestoneIds: vi.fn(),
}));

vi.mock("~/lib/services/milestoneSummary", () => ({
  getTestRunSegments: vi.fn(),
  getSessionSegments: vi.fn(),
  calculateMilestoneCompletion: vi.fn(),
  getMilestoneLinkedIssues: vi.fn(),
}));

import { prisma } from "~/lib/prisma";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import {
  calculateMilestoneCompletion,
  getMilestoneLinkedIssues,
  getSessionSegments,
  getTestRunSegments,
} from "~/lib/services/milestoneSummary";
import { getServerSession } from "next-auth";
import { GET } from "./route";

const createRequest = (
  milestoneId: string
): [NextRequest, { params: Promise<{ milestoneId: string }> }] => {
  const req = new NextRequest(
    `http://localhost/api/milestones/${milestoneId}/export`
  );
  const params = { params: Promise.resolve({ milestoneId }) };
  return [req, params];
};

const adminSession = {
  user: { id: "admin-1", name: "Admin", access: "ADMIN" },
};
const userSession = { user: { id: "user-1", name: "Reg", access: "USER" } };

const baseMilestone = {
  id: 1,
  name: "Release 1.0",
  projectId: 10,
  isStarted: true,
  isCompleted: false,
  startedAt: new Date("2026-05-01T00:00:00.000Z"),
  completedAt: null,
  createdAt: new Date("2026-04-01T00:00:00.000Z"),
  parentId: null,
  creator: { name: "Owner" },
  milestoneType: { name: "Version" },
};

const testRunSegment = (over: Record<string, unknown> = {}) => ({
  id: "test-run-1-1-0",
  type: "test-run" as const,
  sourceId: 100,
  sourceName: "Regression Run",
  statusId: 1,
  statusName: "Passed",
  colorValue: "#22c55e",
  elapsed: 120,
  estimate: 0,
  isPending: false,
  itemCount: 2,
  statusOrder: 1,
  ...over,
});

const sessionSegment = (over: Record<string, unknown> = {}) => ({
  id: "session-200",
  type: "session" as const,
  sourceId: 200,
  sourceName: "Exploratory",
  statusId: 5,
  statusName: "Completed",
  colorValue: "#22c55e",
  elapsed: 60,
  estimate: null,
  isPending: false,
  itemCount: 1,
  statusOrder: 2,
  ...over,
});

describe("GET /api/milestones/[milestoneId]/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAllDescendantMilestoneIds as any).mockResolvedValue([]);
    (getTestRunSegments as any).mockResolvedValue([]);
    (getSessionSegments as any).mockResolvedValue([]);
    (calculateMilestoneCompletion as any).mockResolvedValue(0);
    (getMilestoneLinkedIssues as any).mockResolvedValue([]);
    (prisma.milestones.findUnique as any).mockResolvedValue(baseMilestone);
    (prisma.milestones.findMany as any).mockResolvedValue([]);
    (prisma.reviewRequest.findMany as any).mockResolvedValue([]);
  });

  describe("Input validation & auth", () => {
    it("returns 400 for non-numeric milestoneId", async () => {
      (getServerSession as any).mockResolvedValue(adminSession);
      const [req, ctx] = createRequest("not-a-number");
      const res = await GET(req, ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid milestone ID");
    });

    it("returns 401 when unauthenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);
      const [req, ctx] = createRequest("1");
      const res = await GET(req, ctx);
      expect(res.status).toBe(401);
    });

    it("returns 404 when the milestone does not exist", async () => {
      (getServerSession as any).mockResolvedValue(adminSession);
      (prisma.milestones.findUnique as any).mockResolvedValue(null);
      const [req, ctx] = createRequest("999");
      const res = await GET(req, ctx);
      expect(res.status).toBe(404);
    });
  });

  describe("Contributors, issues, and review decisions", () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(userSession);
      (getTestRunSegments as any).mockResolvedValue([
        testRunSegment(),
        testRunSegment({
          id: "test-run-1-2-1",
          statusName: "Failed",
          colorValue: "#ef4444",
          itemCount: 1,
          isPending: false,
        }),
      ]);
      (getSessionSegments as any).mockResolvedValue([sessionSegment()]);
      (calculateMilestoneCompletion as any).mockResolvedValue(75);
      (getMilestoneLinkedIssues as any).mockResolvedValue([
        {
          id: 1,
          name: "BUG-1",
          title: "Login broken",
          externalId: null,
          externalKey: "JIRA-9",
          externalUrl: null,
          externalStatus: "Open",
          data: null,
          integrationId: null,
          lastSyncedAt: null,
          integration: null,
          projectIds: [10],
        },
      ]);
      (prisma.reviewRequest.findMany as any).mockResolvedValue([
        {
          entityType: "RUN",
          entityId: 100,
          status: "APPROVED",
          decidedAt: new Date("2026-05-15T00:00:00.000Z"),
          decisionComment: "LGTM",
          decidedBy: { name: "Jane" },
        },
      ]);
    });

    it("rolls up status counts and builds per-run contributors", async () => {
      const [req, ctx] = createRequest("1");
      const data = await (await GET(req, ctx)).json();

      expect(data.rollup.completionRate).toBe(75);
      expect(data.rollup.executedItems).toBe(4); // 2 + 1 (runs) + 1 (session)
      expect(data.rollup.totalItems).toBe(4);
      const passed = data.rollup.statusCounts.find(
        (s: any) => s.statusName === "Passed"
      );
      expect(passed.count).toBe(2);

      expect(data.testRuns).toHaveLength(1);
      expect(data.testRuns[0].id).toBe(100);
      expect(data.testRuns[0].statusCounts).toHaveLength(2);

      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].id).toBe(200);

      expect(data.issues[0]).toEqual({
        key: "JIRA-9",
        title: "Login broken",
        status: "Open",
      });
    });

    it("queries review requests for the contributing runs and sessions and shapes decisions", async () => {
      const [req, ctx] = createRequest("1");
      const data = await (await GET(req, ctx)).json();

      const whereArg = (prisma.reviewRequest.findMany as any).mock.calls[0][0]
        .where;
      expect(whereArg.projectId).toBe(10);
      expect(whereArg.isDeleted).toBe(false);
      expect(whereArg.OR).toEqual([
        { entityType: "RUN", entityId: { in: [100] } },
        { entityType: "SESSION", entityId: { in: [200] } },
      ]);

      expect(data.reviewDecisions).toHaveLength(1);
      expect(data.reviewDecisions[0]).toMatchObject({
        entityType: "RUN",
        entityId: 100,
        entityName: "Regression Run",
        status: "APPROVED",
        decidedByName: "Jane",
      });
    });
  });

  describe("Empty milestone", () => {
    it("returns empty sections and skips the review query when there is no data", async () => {
      (getServerSession as any).mockResolvedValue(adminSession);

      const [req, ctx] = createRequest("1");
      const data = await (await GET(req, ctx)).json();

      expect(data.testRuns).toEqual([]);
      expect(data.sessions).toEqual([]);
      expect(data.descendants).toEqual([]);
      expect(data.issues).toEqual([]);
      expect(data.reviewDecisions).toEqual([]);
      expect(prisma.reviewRequest.findMany).not.toHaveBeenCalled();
    });
  });

  describe("Parent path", () => {
    it("walks the parent chain into a root-first path", async () => {
      (getServerSession as any).mockResolvedValue(userSession);
      (prisma.milestones.findUnique as any)
        .mockResolvedValueOnce({ ...baseMilestone, parentId: 2 }) // the milestone
        .mockResolvedValueOnce({ name: "Q2", parentId: 3 }) // parent
        .mockResolvedValueOnce({ name: "FY26", parentId: null }); // grandparent

      const [req, ctx] = createRequest("1");
      const data = await (await GET(req, ctx)).json();

      expect(data.milestone.parentPath).toEqual(["FY26", "Q2"]);
    });
  });
});
