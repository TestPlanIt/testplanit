// Route tests for the Project Health report. Harness mirrors the sibling
// drill-down suite (same db/session mocking style); what is deliberately
// NOT stubbed here is the shared report authorizer and the manual+automated
// completion union — those two seams are the ones a project-health
// regression would land on, so they run for real against a mocked db.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

// `$queryRaw` is the manual+automated union's only db touchpoint, so the
// real `getMilestoneCaseCompletion` runs against this mock rather than being
// stubbed out — the union fold is part of what this suite proves.
vi.mock("@/lib/db", () => ({
  baseDb: {
    milestones: { findMany: vi.fn(), groupBy: vi.fn() },
    issue: { findMany: vi.fn() },
    status: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/projectIssueIds", () => ({
  getProjectRelevantIssueIds: vi.fn(),
}));

// The real authorizer runs; only its two dependencies are stubbed, so the
// 401/403 ladder under test is the shipped one.
vi.mock("~/lib/api-token-auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("~/lib/auth/utils", () => ({ getEnhancedDb: vi.fn() }));

import { getServerSession } from "next-auth";
import { baseDb } from "@/lib/db";
import { getProjectRelevantIssueIds } from "@/lib/projectIssueIds";
import { authenticateRequest } from "~/lib/api-token-auth";
import { getEnhancedDb } from "~/lib/auth/utils";

import { GET, POST } from "./route";

const mockedMilestonesFindMany = baseDb.milestones
  .findMany as unknown as ReturnType<typeof vi.fn>;
const mockedMilestonesGroupBy = baseDb.milestones
  .groupBy as unknown as ReturnType<typeof vi.fn>;
const mockedIssueFindMany = baseDb.issue.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockedQueryRaw = (baseDb as any).$queryRaw as ReturnType<typeof vi.fn>;
const mockedRelevantIssueIds =
  getProjectRelevantIssueIds as unknown as ReturnType<typeof vi.fn>;
const mockedAuthenticate = authenticateRequest as unknown as ReturnType<
  typeof vi.fn
>;
const mockedEnhancedDb = getEnhancedDb as unknown as ReturnType<typeof vi.fn>;

const PROJECT_A = 1;
const PROJECT_B = 2;

const milestoneRow = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Milestone ${id}`,
  isCompleted: false,
  isStarted: true,
  milestoneType: { icon: { name: "flag" } },
  createdAt: new Date("2026-05-01T10:00:00.000Z"),
  createdBy: "user-1",
  creator: { id: "user-1", name: "Test User", email: "u1@example.com" },
  projectId: PROJECT_A,
  ...overrides,
});

function getRequest(query = `?projectId=${PROJECT_A}`): NextRequest {
  return new NextRequest(
    `http://localhost/api/report-builder/project-health${query}`
  );
}

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/report-builder/project-health", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const COMPLETION_LABEL = "Milestone Completion (%)";
const TOTAL_LABEL = "Total Milestones";
const ACTIVE_LABEL = "Active Milestones";

describe("/api/report-builder/project-health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedAuthenticate.mockResolvedValue({
      authenticated: true,
      user: { userId: "user-1", access: "USER" },
    });
    mockedEnhancedDb.mockResolvedValue({
      projects: { findFirst: vi.fn().mockResolvedValue({ id: PROJECT_A }) },
    });
    mockedMilestonesFindMany.mockResolvedValue([milestoneRow(11)]);
    mockedMilestonesGroupBy.mockResolvedValue([]);
    mockedIssueFindMany.mockResolvedValue([]);
    mockedRelevantIssueIds.mockResolvedValue([]);
    // One milestone, 10 run-cases in scope, 7 completed.
    mockedQueryRaw.mockResolvedValue([
      { milestoneId: 11, total: 10n, completed: 7n },
    ]);
  });

  describe("auth", () => {
    it("401s an unauthenticated GET and POST before any read", async () => {
      mockedAuthenticate.mockResolvedValue({
        authenticated: false,
        error: "Unauthorized",
        status: 401,
      });

      const get = await GET(getRequest());
      expect(get.status).toBe(401);

      const post = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: ["totalMilestones"],
        })
      );
      expect(post.status).toBe(401);

      expect(mockedMilestonesFindMany).not.toHaveBeenCalled();
    });

    it("403s a non-admin who cannot read the requested project", async () => {
      mockedEnhancedDb.mockResolvedValue({
        projects: { findFirst: vi.fn().mockResolvedValue(null) },
      });

      const response = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: ["totalMilestones"],
        })
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
      expect(mockedMilestonesFindMany).not.toHaveBeenCalled();
    });

    it("lets an ADMIN through without a per-project membership read", async () => {
      mockedAuthenticate.mockResolvedValue({
        authenticated: true,
        user: { userId: "admin-1", access: "ADMIN" },
      });

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      expect(mockedEnhancedDb).not.toHaveBeenCalled();
    });
  });

  describe("dimension and metric whitelist", () => {
    it("GET advertises exactly the supported dimensions and metrics", async () => {
      const response = await GET(getRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.dimensions.map((d: any) => d.id)).toEqual([
        "milestone",
        "creator",
        "date",
      ]);
      expect(body.metrics).toEqual([
        { id: "milestoneCompletion", label: COMPLETION_LABEL },
        { id: "totalMilestones", label: TOTAL_LABEL },
        { id: "activeMilestones", label: ACTIVE_LABEL },
      ]);
    });

    it("GET 400s without a projectId", async () => {
      const response = await GET(getRequest(""));
      expect(response.status).toBe(400);
    });

    it.each([
      ["dimension", { dimensions: ["milestone", "sprint"] }, /dimension/i],
      ["metric", { metrics: ["velocity"] }, /metric/i],
    ])("POST 400s an unsupported %s by name", async (_label, override, re) => {
      const response = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: ["totalMilestones"],
          ...override,
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toMatch(re);
      expect(mockedMilestonesFindMany).not.toHaveBeenCalled();
    });

    it("POST 400s an empty metric list and a missing projectId", async () => {
      const noMetrics = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: [],
        })
      );
      expect(noMetrics.status).toBe(400);

      const noProject = await POST(
        postRequest({ dimensions: ["milestone"], metrics: ["totalMilestones"] })
      );
      expect(noProject.status).toBe(400);
    });
  });

  describe("project scoping", () => {
    it("anchors every milestone read on the requested project", async () => {
      await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone", "creator", "date"],
          metrics: ["totalMilestones", "activeMilestones"],
        })
      );

      expect(mockedMilestonesFindMany).toHaveBeenCalled();
      for (const [args] of mockedMilestonesFindMany.mock.calls) {
        expect(args.where.projectId).toBe(PROJECT_A);
        expect(args.where.isDeleted).toBe(false);
      }
      for (const [args] of mockedMilestonesGroupBy.mock.calls) {
        expect(args.where.projectId).toBe(PROJECT_A);
      }
    });

    it("draws issue-side dimension values only from this project's issue ids", async () => {
      mockedRelevantIssueIds.mockResolvedValue([101, 102]);

      await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["creator"],
          metrics: ["totalMilestones"],
        })
      );

      expect(mockedRelevantIssueIds).toHaveBeenCalledWith(PROJECT_A);
      expect(mockedRelevantIssueIds).not.toHaveBeenCalledWith(PROJECT_B);
      for (const [args] of mockedIssueFindMany.mock.calls) {
        expect(args.where.id).toEqual({ in: [101, 102] });
        expect(args.where.isDeleted).toBe(false);
      }
    });

    it("never asks the completion union about another project's milestones", async () => {
      // Project A owns milestone 11 only; 22 belongs to project B and must
      // not reach the union even though it exists in the database.
      mockedMilestonesFindMany.mockResolvedValue([milestoneRow(11)]);

      await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: ["milestoneCompletion"],
        })
      );

      // $queryRaw is a tagged template: [strings, milestoneIds, runTypes].
      const milestoneIds = mockedQueryRaw.mock.calls[0][1];
      expect(milestoneIds).toEqual([11]);
      expect(milestoneIds).not.toContain(22);
    });

    it("counts no rows at all when the caller's project has no milestones", async () => {
      mockedMilestonesFindMany.mockResolvedValue([]);

      const response = await POST(
        postRequest({
          projectId: PROJECT_B,
          dimensions: ["milestone"],
          metrics: ["milestoneCompletion"],
        })
      );

      expect(await response.json()).toEqual({ results: [] });
      // No milestone ids -> the union is never queried for another project's.
      expect(mockedQueryRaw).not.toHaveBeenCalled();
    });
  });

  describe("milestone completion — the manual + automated result union", () => {
    it("reports one percentage over BOTH sources' counts", async () => {
      const response = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: ["milestoneCompletion"],
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.results).toHaveLength(1);
      expect(body.results[0].milestone).toMatchObject({
        id: 11,
        name: "Milestone 11",
      });
      // 7 of 10 run-cases completed, counted across manual run-cases and
      // automated results together.
      expect(body.results[0][COMPLETION_LABEL]).toBe(70);
    });

    it("sums the per-milestone union counts when several milestones share a group", async () => {
      // Both milestones share a creator, so grouping by creator folds their
      // union counts into one denominator: (10 + 10) cases, (7 + 3) done.
      mockedMilestonesFindMany.mockResolvedValue([
        milestoneRow(11),
        milestoneRow(12),
      ]);
      mockedQueryRaw.mockResolvedValue([
        { milestoneId: 11, total: 10n, completed: 7n },
        { milestoneId: 12, total: 10n, completed: 3n },
      ]);

      const response = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["creator"],
          metrics: ["milestoneCompletion"],
        })
      );
      const body = await response.json();

      expect(body.results).toHaveLength(1);
      expect(body.results[0][COMPLETION_LABEL]).toBe(50);
    });

    it("reports null — never a misleading 0% — for a milestone with no run-cases", async () => {
      mockedQueryRaw.mockResolvedValue([]);

      const response = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: ["milestoneCompletion"],
        })
      );
      const body = await response.json();

      // The row survives the zero-filter (percentage metrics keep null and 0)
      // so the table can render "—".
      expect(body.results).toHaveLength(1);
      expect(body.results[0][COMPLETION_LABEL]).toBeNull();
    });

    it("reports a real 0% when nothing in a populated milestone is done", async () => {
      mockedQueryRaw.mockResolvedValue([
        { milestoneId: 11, total: 8n, completed: 0n },
      ]);

      const response = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: ["milestoneCompletion"],
        })
      );
      const body = await response.json();

      expect(body.results[0][COMPLETION_LABEL]).toBe(0);
    });
  });

  describe("empty range", () => {
    it("returns { results: [] } when no dimension has any value", async () => {
      mockedMilestonesFindMany.mockResolvedValue([]);
      mockedRelevantIssueIds.mockResolvedValue([]);

      const response = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: ["totalMilestones"],
        })
      );

      expect(response.status).toBe(200);
      // A bare empty list, not a null or a single all-zero row.
      expect(await response.json()).toEqual({ results: [] });
    });

    it("drops zero-valued count rows so 'no data' is empty rather than a wall of zeros", async () => {
      // The dimension has a value (so a row IS built) but the metric's own
      // aggregate has nothing for it — a count of 0 must not be listed.
      mockedMilestonesFindMany.mockResolvedValue([milestoneRow(11)]);
      mockedMilestonesGroupBy.mockResolvedValue([]);

      const response = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: ["activeMilestones"],
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.results).toEqual([]);
    });

    it("still shapes a full row when a count metric does have a value", async () => {
      mockedMilestonesGroupBy.mockResolvedValue([
        { id: 11, _count: { _all: 1 } },
      ]);

      const response = await POST(
        postRequest({
          projectId: PROJECT_A,
          dimensions: ["milestone"],
          metrics: ["totalMilestones"],
        })
      );
      const body = await response.json();

      expect(body.results).toEqual([
        {
          milestone: {
            id: 11,
            name: "Milestone 11",
            isCompleted: false,
            isStarted: true,
            milestoneType: { icon: { name: "flag" } },
          },
          [TOTAL_LABEL]: 1,
        },
      ]);
    });
  });
});
