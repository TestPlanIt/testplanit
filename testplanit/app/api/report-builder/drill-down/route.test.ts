import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing route handler
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  baseDb: {
    status: { findMany: vi.fn() },
    issue: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/projectIssueIds", () => ({
  getProjectRelevantIssueIds: vi.fn(),
}));

vi.mock("~/lib/services/milestoneMemberCoverage", () => ({
  getMemberCoverage: vi.fn(),
}));

vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));

vi.mock("~/utils/drillDownQueryBuilders", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    DRILL_DOWN_DIMENSIONS_BY_REPORT: actual.DRILL_DOWN_DIMENSIONS_BY_REPORT,
    getModelForMetric: vi.fn(),
    getQueryBuilderForMetric: vi.fn(),
    buildTestExecutionQuery: vi.fn(),
    buildJunitResultQuery: vi.fn(),
  };
});

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(),
}));

import { baseDb } from "@/lib/db";
import { getProjectRelevantIssueIds } from "@/lib/projectIssueIds";
import { getEnhancedDb } from "~/lib/auth/utils";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { getMemberCoverage } from "~/lib/services/milestoneMemberCoverage";
import { getServerSession } from "next-auth";
import {
  buildJunitResultQuery,
  buildTestExecutionQuery,
  getModelForMetric,
  getQueryBuilderForMetric,
} from "~/utils/drillDownQueryBuilders";
import { POST } from "./route";

const createRequest = (body: Record<string, unknown>): NextRequest => {
  return new NextRequest("http://localhost/api/report-builder/drill-down", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
};

const mockSession = {
  user: { id: "user-1", name: "Test User", access: "USER" },
};

const mockAdminSession = {
  user: { id: "admin-1", name: "Admin User", access: "ADMIN" },
};

const validDrillDownContext = {
  metricId: "testResults",
  reportType: "test-execution",
  projectId: 1,
};

describe("POST /api/report-builder/drill-down", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: mock a model with findMany, count, groupBy
    const mockModel = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 1,
          testRunCase: { repositoryCase: { name: "Login Test" } },
          executedAt: "2024-01-01T00:00:00Z",
        },
      ]),
      count: vi.fn().mockResolvedValue(1),
      groupBy: vi.fn().mockResolvedValue([]),
    };

    (getModelForMetric as any).mockReturnValue("testRunResults");
    (getQueryBuilderForMetric as any).mockReturnValue(() => ({
      where: { testRun: { projectId: 1 } },
      include: { testRunCase: true },
    }));
    // Dual-source path defaults: manual query realistic, JUnit side skipped
    // so single-source expectations keep holding.
    (buildTestExecutionQuery as any).mockReturnValue({
      where: { testRun: { projectId: 1 } },
      include: { testRunCase: true },
    });
    (buildJunitResultQuery as any).mockReturnValue(null);
    (baseDb as any).jUnitTestResult = {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    };

    // Inject mockModel by mocking baseDb as dynamic
    (baseDb as any).testRunResults = mockModel;

    (baseDb.status.findMany as any).mockResolvedValue([]);

    // Default: the caller can read the project (membership gate passes)
    (getEnhancedDb as any).mockResolvedValue({
      projects: { findFirst: vi.fn().mockResolvedValue({ id: 1 }) },
    });
  });

  describe("Authentication", () => {
    it("returns 401 when no session", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const response = await POST(
        createRequest({ context: validDrillDownContext })
      );
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 when context is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(createRequest({}));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("drill-down context");
    });

    it("returns 400 when context.metricId is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ context: { reportType: "test-execution" } })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("drill-down context");
    });

    it("returns 400 when context.reportType is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ context: { metricId: "testResults" } })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("drill-down context");
    });

    it("returns 403 when the user cannot read the requested project", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (getEnhancedDb as any).mockResolvedValue({
        projects: { findFirst: vi.fn().mockResolvedValue(null) },
      });

      const response = await POST(
        createRequest({ context: validDrillDownContext })
      );
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Forbidden");
    });

    it("returns 403 when cross-project mode and user is not admin", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({
          context: {
            ...validDrillDownContext,
            mode: "cross-project",
          },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain("Admin access required");
    });
  });

  describe("Successful drill-down", () => {
    it("returns drill-down data with correct shape", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ context: validDrillDownContext })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("data");
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("hasMore");
      expect(data).toHaveProperty("context");
      expect(Array.isArray(data.data)).toBe(true);
    });

    it("returns correct total and hasMore=false when all records fit", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ context: validDrillDownContext, offset: 0, limit: 50 })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.total).toBe(1);
      expect(data.hasMore).toBe(false);
    });

    it("returns hasMore=true when more records exist beyond limit", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      // Mock: 10 items returned, total is 100
      const mockModel = (baseDb as any).testRunResults;
      mockModel.findMany.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ id: i + 1, testRunCase: null }))
      );
      mockModel.count.mockResolvedValue(100);

      const response = await POST(
        createRequest({ context: validDrillDownContext, offset: 0, limit: 10 })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.total).toBe(100);
      expect(data.hasMore).toBe(true);
    });

    it("transforms test result records to include name field from repositoryCase", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await POST(
        createRequest({ context: validDrillDownContext })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data[0].name).toBe("Login Test");
    });

    it("allows admin user to perform cross-project drill-down", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const response = await POST(
        createRequest({
          context: {
            ...validDrillDownContext,
            mode: "cross-project",
          },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("data");
    });

    it("returns 400 when model name is invalid", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (getModelForMetric as any).mockReturnValue("nonExistentModel");

      const response = await POST(
        createRequest({
          context: { ...validDrillDownContext, metricId: "testRuns" },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid model");
    });

    it("includes dual-source passRate aggregates judged by isSuccess", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (buildTestExecutionQuery as any).mockReturnValue({
        where: { testRun: { projectId: 1 } },
        include: {},
      });
      (buildJunitResultQuery as any).mockReturnValue({
        where: { statusId: { not: null } },
        include: {},
      });

      (baseDb as any).testRunResults = {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(4),
        groupBy: vi.fn().mockResolvedValue([
          { statusId: 1, _count: { id: 3 } },
          { statusId: 2, _count: { id: 1 } },
        ]),
      };
      (baseDb as any).jUnitTestResult = {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(6),
        groupBy: vi
          .fn()
          .mockResolvedValue([{ statusId: 1, _count: { id: 6 } }]),
      };
      (baseDb.status.findMany as any).mockResolvedValue([
        {
          id: 1,
          name: "Passed",
          isSuccess: true,
          color: { value: "#22c55e" },
        },
        {
          id: 2,
          name: "Failed",
          isSuccess: false,
          color: { value: "#ef4444" },
        },
      ]);

      const response = await POST(
        createRequest({
          context: {
            metricId: "passRate",
            reportType: "test-execution",
            projectId: 1,
            dimensions: {},
          },
        })
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      // 3 manual passed + 6 junit passed of 10 total (isSuccess-based)
      expect(data.aggregates.passRate).toBe(90);
      expect(data.aggregates.statusCounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ statusId: 1, count: 9 }),
          expect.objectContaining({ statusId: 2, count: 1 }),
        ])
      );
      expect(data.total).toBe(10);
    });
  });

  describe("Elapsed metric drill-down (manual + JUnit)", () => {
    const elapsedContext = {
      metricId: "avgElapsedTime",
      reportType: "test-execution",
      projectId: 1,
      dimensions: {},
    };

    const manualRecord = {
      id: 10,
      elapsed: 30,
      executedAt: "2024-01-01T10:00:00Z",
      testRunCase: { repositoryCase: { name: "Manual Case" } },
    };

    const junitRecord = {
      id: 10, // Same numeric id as the manual record on purpose
      time: 58.5,
      executedAt: "2024-01-01T11:00:00Z",
      createdById: "user-2",
      createdBy: { id: "user-2", name: "Bot" },
      statusId: 2,
      status: { id: 2, name: "Passed", color: { value: "#22c55e" } },
      repositoryCase: { id: 42, name: "Automated Case", hasParameters: false },
      testSuite: { testRun: { id: 200, name: "CI Run", projectId: 1 } },
    };

    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (buildTestExecutionQuery as any).mockReturnValue({
        where: { testRun: { projectId: 1 } },
        include: {},
        skip: 0,
        take: 50,
      });
      (buildJunitResultQuery as any).mockReturnValue({
        where: { time: { gt: 0 } },
        include: {},
      });

      (baseDb as any).testRunResults = {
        findMany: vi.fn().mockResolvedValue([manualRecord]),
        count: vi.fn().mockResolvedValue(1),
      };
      (baseDb as any).jUnitTestResult = {
        findMany: vi.fn().mockResolvedValue([junitRecord]),
        count: vi.fn().mockResolvedValue(1),
      };
    });

    it("combines manual and JUnit rows with a shared total", async () => {
      const response = await POST(createRequest({ context: elapsedContext }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.total).toBe(2);
      expect(data.data).toHaveLength(2);
      expect(data.data[0].name).toBe("Manual Case");
      expect(data.data[1]).toMatchObject({
        id: "junit-10",
        name: "Automated Case",
        elapsed: 58.5,
        executedById: "user-2",
        testRunId: 200,
      });
    });

    it("filters the manual side to duration-bearing rows", async () => {
      await POST(createRequest({ context: elapsedContext }));

      const manualWhere = (baseDb as any).testRunResults.count.mock.calls[0][0]
        .where;
      expect(manualWhere.elapsed).toEqual({ not: null });
    });

    it("pages into the JUnit block once manual rows are exhausted", async () => {
      (baseDb as any).testRunResults.count.mockResolvedValue(3);
      (baseDb as any).jUnitTestResult.count.mockResolvedValue(10);

      await POST(
        createRequest({ context: elapsedContext, offset: 5, limit: 50 })
      );

      expect((baseDb as any).testRunResults.findMany).not.toHaveBeenCalled();
      const junitArgs = (baseDb as any).jUnitTestResult.findMany.mock
        .calls[0][0];
      expect(junitArgs.skip).toBe(2); // offset 5 - 3 manual rows
    });

    it("passes the drill-down context straight to the JUnit builder", async () => {
      const context = {
        ...elapsedContext,
        dimensions: { testCase: { id: 108205, name: "SCORM export case" } },
      };
      await POST(createRequest({ context }));

      expect(buildJunitResultQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          dimensions: { testCase: { id: 108205, name: "SCORM export case" } },
        }),
        { requireTime: true }
      );
    });

    it("skips the JUnit side entirely when the builder returns null", async () => {
      (buildJunitResultQuery as any).mockReturnValue(null);

      const response = await POST(createRequest({ context: elapsedContext }));
      const data = await response.json();

      expect((baseDb as any).jUnitTestResult.findMany).not.toHaveBeenCalled();
      expect(data.total).toBe(1);
      expect(data.data).toHaveLength(1);
    });
  });

  describe("milestone-readiness drill-down", () => {
    beforeEach(() => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (getEnhancedDb as any).mockResolvedValue({
        projects: { findFirst: vi.fn().mockResolvedValue({ id: 1 }) },
      });
      (resolveViewerProjectScope as any).mockResolvedValue(null);
    });

    it("drills a readiness cell into the member issues in that state", async () => {
      // Issue 101 fully passes, 102 fails, 103 has no linked cases.
      (getMemberCoverage as any).mockResolvedValue({
        101: {
          uncovered: false,
          linkedCaseCount: 2,
          failed: 0,
          inProgress: 0,
          notRun: 0,
        },
        102: {
          uncovered: false,
          linkedCaseCount: 1,
          failed: 1,
          inProgress: 0,
          notRun: 0,
        },
        103: {
          uncovered: true,
          linkedCaseCount: 0,
          failed: 0,
          inProgress: 0,
          notRun: 0,
        },
      });
      ((baseDb as any).issue.findMany as any).mockResolvedValue([
        { id: 102, name: "ISS-102", title: "Broken" },
      ]);

      const response = await POST(
        createRequest({
          context: {
            metricId: "failed",
            metricLabel: "Failed",
            metricValue: 1,
            reportType: "milestone-readiness",
            mode: "project",
            projectId: 1,
            dimensions: { milestone: { id: 55, name: "R1" } },
          },
        })
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.total).toBe(1);
      expect(data.data[0].id).toBe(102);
      expect((baseDb as any).issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [102] } } })
      );
      expect(getMemberCoverage).toHaveBeenCalledWith(55, {
        projectId: 1,
        accessibleProjectIds: null,
      });
    });

    it("percentReady drills into the fully-passing member issues", async () => {
      (getMemberCoverage as any).mockResolvedValue({
        101: {
          uncovered: false,
          linkedCaseCount: 2,
          failed: 0,
          inProgress: 0,
          notRun: 0,
        },
        102: {
          uncovered: false,
          linkedCaseCount: 1,
          failed: 1,
          inProgress: 0,
          notRun: 0,
        },
      });
      ((baseDb as any).issue.findMany as any).mockResolvedValue([
        { id: 101, name: "ISS-101" },
      ]);

      const response = await POST(
        createRequest({
          context: {
            metricId: "percentReady",
            metricLabel: "Ready (%)",
            metricValue: 50,
            reportType: "milestone-readiness",
            mode: "project",
            projectId: 1,
            dimensions: { milestone: { id: 55, name: "R1" } },
          },
        })
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.total).toBe(1);
      expect((baseDb as any).issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [101] } } })
      );
    });

    it("requires a milestone dimension", async () => {
      const response = await POST(
        createRequest({
          context: {
            metricId: "passed",
            metricLabel: "Passed",
            metricValue: 1,
            reportType: "milestone-readiness",
            mode: "project",
            projectId: 1,
            dimensions: {},
          },
        })
      );

      expect(response.status).toBe(400);
    });
  });

  describe("dimension whitelist", () => {
    it("rejects unknown dimension keys for whitelisted report types", async () => {
      (getServerSession as any).mockResolvedValue(mockAdminSession);

      const response = await POST(
        createRequest({
          context: {
            metricId: "testResults",
            metricLabel: "Test Results",
            metricValue: 1,
            reportType: "test-execution",
            mode: "project",
            projectId: 1,
            dimensions: { bogus: { id: 1, name: "?" } },
          },
        })
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("bogus");
    });
  });

  describe("issue drill-down population", () => {
    it("project-scoped issue drill-downs use the project-relevant issue ids", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (getEnhancedDb as any).mockResolvedValue({
        projects: { findFirst: vi.fn().mockResolvedValue({ id: 1 }) },
      });
      (getModelForMetric as any).mockReturnValue("issue");
      (getQueryBuilderForMetric as any).mockReturnValue(() => ({
        where: { isDeleted: false, projectId: 1 },
        include: {},
      }));
      (getProjectRelevantIssueIds as any).mockResolvedValue([7, 8]);
      ((baseDb as any).issue.findMany as any).mockResolvedValue([
        { id: 7, name: "ISS-7" },
        { id: 8, name: "ISS-8" },
      ]);
      ((baseDb as any).issue.count as any).mockResolvedValue(2);

      const response = await POST(
        createRequest({
          context: {
            metricId: "issueCount",
            metricLabel: "Issue Count",
            metricValue: 2,
            reportType: "issue-tracking",
            mode: "project",
            projectId: 1,
            dimensions: {},
          },
        })
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.total).toBe(2);
      // Direct-FK scoping is swapped for the linked population.
      expect((baseDb as any).issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isDeleted: false, id: { in: [7, 8] } },
        })
      );
    });
  });
});
