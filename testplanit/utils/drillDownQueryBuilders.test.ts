import { describe, expect, it } from "vitest";
import { DEFECT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import type { DrillDownContext } from "~/lib/types/reportDrillDown";
import {
  buildIssuesQuery,
  buildJunitResultQuery,
  buildMilestoneCompletionQuery,
  buildMilestonesQuery,
  buildRepositoryStatsQuery,
  buildSessionResultsQuery,
  buildSessionsQuery,
  buildTestCasesQuery,
  buildTestExecutionQuery,
  buildTestRunsQuery,
  DRILL_DOWN_DIMENSIONS_BY_REPORT,
  getModelForMetric,
  getQueryBuilderForMetric,
} from "./drillDownQueryBuilders";
import {
  createIssueTrackingDimensionRegistry,
  createRepositoryStatsDimensionRegistry,
  createTestExecutionDimensionRegistry,
  createUserEngagementDimensionRegistry,
} from "./reportUtils";

// Helper to create a base context
function createBaseContext(
  overrides: Partial<DrillDownContext> = {}
): DrillDownContext {
  return {
    metricId: "testResults",
    metricLabel: "Test Results",
    metricValue: 100,
    reportType: "test-execution",
    mode: "project",
    projectId: 1,
    dimensions: {},
    ...overrides,
  };
}

describe("drillDownQueryBuilders", () => {
  describe("buildTestExecutionQuery", () => {
    it("should build basic query with project filter", () => {
      const context = createBaseContext({ projectId: 5 });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.testRun).toEqual({
        projectId: 5,
        isDeleted: false,
      });
      expect(result.where?.isDeleted).toBe(false);
      expect(result.skip).toBe(0);
      expect(result.take).toBe(10);
      expect(result.orderBy).toEqual({ executedAt: "desc" });
    });

    it("should apply user dimension filter", () => {
      const context = createBaseContext({
        dimensions: { user: { id: "user-123", name: "Test User" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.executedById).toBe("user-123");
    });

    it("should apply status dimension filter", () => {
      const context = createBaseContext({
        dimensions: { status: { id: 2, name: "Passed" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.statusId).toBe(2);
    });

    it("should filter the testCase dimension by repository case id", () => {
      const context = createBaseContext({
        dimensions: { testCase: { id: 108205, name: "SCORM export case" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.testRunCase).toMatchObject({
        repositoryCaseId: 108205,
      });
    });

    it("should apply configuration dimension filter", () => {
      const context = createBaseContext({
        dimensions: { configuration: { id: 3, name: "Chrome" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.testRun).toMatchObject({ configId: 3 });
    });

    it("should handle null configuration (None)", () => {
      const context = createBaseContext({
        dimensions: { configuration: { id: null as any, name: "None" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.testRun).toMatchObject({ configId: null });
    });

    it("should apply milestone dimension filter", () => {
      const context = createBaseContext({
        dimensions: { milestone: { id: 10, name: "Sprint 1" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.testRun).toMatchObject({
        milestone: { id: 10 },
      });
    });

    it("should apply testRun dimension filter", () => {
      const context = createBaseContext({
        dimensions: { testRun: { id: 20, name: "Run 1" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.testRun).toMatchObject({ id: 20 });
    });

    it("should handle null testRun (deleted)", () => {
      const context = createBaseContext({
        dimensions: { testRun: { id: null as any, name: "None" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.testRun).toMatchObject({ isDeleted: true });
    });

    it("should apply date dimension filter", () => {
      const context = createBaseContext({
        dimensions: { date: { id: "2024-06-15", executedAt: "2024-06-15" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.executedAt).toBeDefined();
      expect((result.where?.executedAt as any).gte).toBeInstanceOf(Date);
      expect((result.where?.executedAt as any).lt).toBeInstanceOf(Date);
    });

    it("should apply date range filters", () => {
      const context = createBaseContext({
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.executedAt).toBeDefined();
      expect((result.where?.executedAt as any).gte).toBeInstanceOf(Date);
      expect((result.where?.executedAt as any).lt).toBeInstanceOf(Date);
    });

    it("should exclude untested status by default", () => {
      const context = createBaseContext();
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.status).toEqual({
        systemName: { not: "untested" },
      });
    });

    it("should not exclude untested when status filter is set", () => {
      const context = createBaseContext({
        dimensions: { status: { id: 1, name: "Untested" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.statusId).toBe(1);
      expect(result.where?.status).toBeUndefined();
    });

    it("should apply cross-project mode project filter", () => {
      const context = createBaseContext({
        mode: "cross-project",
        projectId: undefined,
        dimensions: { project: { id: 7, name: "Project 7" } },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.testRun).toMatchObject({ projectId: 7 });
    });

    it("should include correct relations", () => {
      const context = createBaseContext();
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.include?.status).toBeDefined();
      expect(result.include?.executedBy).toBe(true);
      expect(result.include?.testRun).toBeDefined();
      expect(result.include?.testRunCase).toBeDefined();
    });
  });

  describe("buildJunitResultQuery", () => {
    it("should build basic query with project filter through the suite's run", () => {
      const context = createBaseContext({ projectId: 5 });
      const result = buildJunitResultQuery(context);

      expect(result?.where).toMatchObject({
        statusId: { not: null },
        status: { systemName: { not: "untested" } },
        testSuite: { testRun: { projectId: 5 } },
      });
      expect(result?.where.time).toBeUndefined();
      expect(result?.orderBy).toEqual({ executedAt: "desc" });
    });

    it("requires a duration only for elapsed metrics", () => {
      const context = createBaseContext({ projectId: 5 });
      const result = buildJunitResultQuery(context, { requireTime: true });

      expect(result?.where.time).toEqual({ gt: 0 });
    });

    it("should map user dimension to createdById", () => {
      const context = createBaseContext({
        dimensions: { user: { id: "user-123", name: "Test User" } },
      });
      const result = buildJunitResultQuery(context);

      expect(result?.where.createdById).toBe("user-123");
    });

    it("should apply status and date dimension filters", () => {
      const context = createBaseContext({
        dimensions: {
          status: { id: 2, name: "Passed" },
          date: { id: "2024-01-15", executedAt: "2024-01-15T00:00:00.000Z" },
        },
      });
      const result = buildJunitResultQuery(context);

      expect(result?.where.statusId).toBe(2);
      expect(result?.where.executedAt.gte).toEqual(
        new Date("2024-01-15T00:00:00.000Z")
      );
    });

    it("should match the testCase dimension's repository case id directly", () => {
      const context = createBaseContext({
        dimensions: { testCase: { id: 42, name: "Login Test" } },
      });
      const result = buildJunitResultQuery(context);

      expect(result?.where.repositoryCaseId).toBe(42);
    });

    it("should return null for a testCase dimension without an id", () => {
      const context = createBaseContext({
        dimensions: { testCase: { id: null as any, name: "None" } },
      });

      expect(buildJunitResultQuery(context)).toBeNull();
    });

    it("should apply folder and tag filters on the linked repository case", () => {
      const context = createBaseContext({
        dimensions: {
          folder: { id: 7, name: "Smoke" },
          tag: { id: 3, name: "regression" },
        },
      });
      const result = buildJunitResultQuery(context);

      expect(result?.where.repositoryCase).toEqual({
        folderId: 7,
        caseTags: { some: { tag: { id: 3 } } },
      });
    });
  });

  describe("buildTestRunsQuery", () => {
    it("should build basic query with project filter", () => {
      const context = createBaseContext({ projectId: 5 });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.projectId).toBe(5);
      expect(result.skip).toBe(0);
      expect(result.take).toBe(10);
      expect(result.orderBy).toEqual({ createdAt: "desc" });
    });

    it("maps the user dimension to the run creator", () => {
      const context = createBaseContext({
        dimensions: { user: { id: "user-456", name: "User" } },
      });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.createdById).toBe("user-456");
    });

    it("derives status membership from both result sources", () => {
      const context = createBaseContext({
        dimensions: { status: { id: 3, name: "Failed" } },
      });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.OR).toEqual([
        { results: { some: { isDeleted: false, statusId: 3 } } },
        {
          junitTestSuites: {
            some: { results: { some: { statusId: 3 } } },
          },
        },
      ]);
    });

    it("applies the date dimension and range to the run's createdAt", () => {
      const context = createBaseContext({
        dimensions: { date: { id: "2024-06-15", executedAt: "2024-06-15" } },
        endDate: "2024-06-30",
      });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.createdAt).toBeDefined();
      expect((result.where?.createdAt as any).gte).toBeInstanceOf(Date);
    });

    it("should apply configuration dimension filter", () => {
      const context = createBaseContext({
        dimensions: { configuration: { id: 4, name: "Firefox" } },
      });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.configId).toBe(4);
    });

    it("should handle null configuration", () => {
      const context = createBaseContext({
        dimensions: { configuration: { id: null as any, name: "None" } },
      });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.configId).toBeNull();
    });

    it("should apply milestone dimension filter", () => {
      const context = createBaseContext({
        dimensions: { milestone: { id: 15, name: "Release 1.0" } },
      });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.milestone).toEqual({ id: 15 });
    });

    it("should handle null milestone", () => {
      const context = createBaseContext({
        dimensions: { milestone: { id: null as any, name: "None" } },
      });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.milestoneId).toBeNull();
    });

    it("should include correct relations", () => {
      const context = createBaseContext();
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.include?.project).toBeDefined();
      expect(result.include?.state).toBeDefined();
      expect(result.include?.createdBy).toBe(true);
      expect(result.include?.milestone).toBeDefined();
    });
  });

  describe("buildRepositoryStatsQuery", () => {
    it("should build basic query with project filter and isDeleted false", () => {
      const context = createBaseContext({
        reportType: "repository-stats",
        projectId: 8,
      });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.projectId).toBe(8);
      expect(result.where?.isDeleted).toBe(false);
    });

    it("should apply creator dimension filter", () => {
      const context = createBaseContext({
        reportType: "repository-stats",
        dimensions: { creator: { id: "creator-1", name: "Creator" } },
      });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.creatorId).toBe("creator-1");
    });

    it("should apply user dimension as creator filter", () => {
      const context = createBaseContext({
        reportType: "user-engagement",
        dimensions: { user: { id: "user-1", name: "User" } },
      });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.creatorId).toBe("user-1");
    });

    it("should apply folder dimension filter", () => {
      const context = createBaseContext({
        dimensions: { folder: { id: 100, name: "Folder" } },
      });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.folderId).toBe(100);
    });

    it("should apply state dimension filter", () => {
      const context = createBaseContext({
        dimensions: { state: { id: 5, name: "Active" } },
      });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.stateId).toBe(5);
    });

    it("should apply template dimension filter", () => {
      const context = createBaseContext({
        dimensions: { template: { id: 3, name: "Template" } },
      });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.templateId).toBe(3);
    });

    it("should handle null template", () => {
      const context = createBaseContext({
        dimensions: { template: { id: null as any, name: "None" } },
      });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.templateId).toEqual({ is: null });
    });

    it("should apply source dimension filter", () => {
      const context = createBaseContext({
        dimensions: { source: { id: "MANUAL", name: "Manual" } },
      });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.source).toBe("MANUAL");
    });

    it("should apply testCase dimension filter", () => {
      const context = createBaseContext({
        dimensions: { testCase: { id: 42, name: "My Test Case" } },
      });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.id).toBe(42);
    });

    it("should filter automated for automatedCount metric", () => {
      const context = createBaseContext({ metricId: "automatedCount" });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.automated).toBe(true);
    });

    it("should filter manual for manualCount metric", () => {
      const context = createBaseContext({ metricId: "manualCount" });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.automated).toBe(false);
    });

    it("should include steps for step-related metrics", () => {
      const context = createBaseContext({ metricId: "averageSteps" });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.include?.steps).toBeDefined();
    });
  });

  describe("buildTestCasesQuery", () => {
    it("should build query with isDeleted false", () => {
      const context = createBaseContext();
      const result = buildTestCasesQuery(context, 0, 10);

      expect(result.where?.isDeleted).toBe(false);
    });

    it("should filter by testRun project through both membership branches", () => {
      const context = createBaseContext({ projectId: 10 });
      const result = buildTestCasesQuery(context, 0, 10);

      // Filtered through the run scope in each OR branch, not directly on
      // the repository case's own projectId
      expect(result.where?.projectId).toBeUndefined();
      const [manualBranch, junitBranch] = result.where?.OR as any[];
      expect(manualBranch.testRuns.some.results.some.testRun.projectId).toBe(
        10
      );
      expect(junitBranch.junitResults.some.testSuite.testRun.projectId).toBe(
        10
      );
    });

    it("should apply user dimension filter to both sources", () => {
      const context = createBaseContext({
        dimensions: { user: { id: "exec-user", name: "Executor" } },
      });
      const result = buildTestCasesQuery(context, 0, 10);

      const [manualBranch, junitBranch] = result.where?.OR as any[];
      expect(manualBranch.testRuns.some.results.some.executedById).toBe(
        "exec-user"
      );
      expect(junitBranch.junitResults.some.createdById).toBe("exec-user");
    });

    it("should apply status dimension filter to both sources", () => {
      const context = createBaseContext({
        dimensions: { status: { id: 4, name: "Blocked" } },
      });
      const result = buildTestCasesQuery(context, 0, 10);

      const [manualBranch, junitBranch] = result.where?.OR as any[];
      expect(manualBranch.testRuns.some.results.some.statusId).toBe(4);
      expect(junitBranch.junitResults.some.statusId).toBe(4);
    });

    it("excludes untested placeholders from both membership branches", () => {
      const context = createBaseContext({ metricId: "testCaseCount" });
      const result = buildTestCasesQuery(context, 0, 10);

      const [manualBranch, junitBranch] = result.where?.OR as any[];
      expect(manualBranch.testRuns.some.results.some.status).toEqual({
        systemName: { not: "untested" },
      });
      expect(junitBranch.junitResults.some.status).toEqual({
        systemName: { not: "untested" },
      });
      expect(junitBranch.junitResults.some.statusId).toEqual({ not: null });
    });

    it("should apply date range filters to both sources", () => {
      const context = createBaseContext({
        startDate: "2024-03-01",
        endDate: "2024-03-31",
      });
      const result = buildTestCasesQuery(context, 0, 10);

      const [manualBranch, junitBranch] = result.where?.OR as any[];
      expect(manualBranch.testRuns.some.results.some.executedAt).toBeDefined();
      expect(junitBranch.junitResults.some.executedAt).toBeDefined();
    });
  });

  describe("buildSessionsQuery", () => {
    it("should build basic query with project filter", () => {
      const context = createBaseContext({ projectId: 12 });
      const result = buildSessionsQuery(context, 0, 10);

      expect(result.where?.projectId).toBe(12);
      expect(result.orderBy).toEqual({ createdAt: "desc" });
    });

    it("should apply user dimension filter to createdById", () => {
      const context = createBaseContext({
        dimensions: { user: { id: "session-creator", name: "Creator" } },
      });
      const result = buildSessionsQuery(context, 0, 10);

      expect(result.where?.createdById).toBe("session-creator");
    });

    it("should apply date dimension filter", () => {
      const context = createBaseContext({
        dimensions: { date: { id: "2024-05-01", executedAt: "2024-05-01" } },
      });
      const result = buildSessionsQuery(context, 0, 10);

      expect(result.where?.createdAt).toBeDefined();
    });

    it("should include correct relations", () => {
      const context = createBaseContext();
      const result = buildSessionsQuery(context, 0, 10);

      expect(result.include?.project).toBeDefined();
      expect(result.include?.createdBy).toBe(true);
    });
  });

  describe("buildSessionResultsQuery", () => {
    it("should build query with session project filter", () => {
      const context = createBaseContext({ projectId: 15 });
      const result = buildSessionResultsQuery(context, 0, 10);

      expect(result.where?.session?.projectId).toBe(15);
      expect(result.where?.session?.isDeleted).toBe(false);
    });

    it("should apply user dimension filter", () => {
      const context = createBaseContext({
        dimensions: { user: { id: "result-creator", name: "Creator" } },
      });
      const result = buildSessionResultsQuery(context, 0, 10);

      expect(result.where?.createdById).toBe("result-creator");
    });

    it("should apply cross-project mode filter", () => {
      const context = createBaseContext({
        mode: "cross-project",
        projectId: undefined,
        dimensions: { project: { id: 20, name: "Project 20" } },
      });
      const result = buildSessionResultsQuery(context, 0, 10);

      expect(result.where?.session?.projectId).toBe(20);
    });
  });

  describe("buildIssuesQuery", () => {
    it("should build basic query with project filter", () => {
      const context = createBaseContext({ projectId: 25 });
      const result = buildIssuesQuery(context, 0, 10);

      expect(result.where?.projectId).toBe(25);
    });

    it("should apply user dimension filter", () => {
      const context = createBaseContext({
        dimensions: { user: { id: "issue-creator", name: "Creator" } },
      });
      const result = buildIssuesQuery(context, 0, 10);

      expect(result.where?.createdById).toBe("issue-creator");
    });

    it("should apply date dimension filter", () => {
      const context = createBaseContext({
        dimensions: { date: { id: "2024-08-15", executedAt: "2024-08-15" } },
      });
      const result = buildIssuesQuery(context, 0, 10);

      expect(result.where?.createdAt).toBeDefined();
    });

    it("should include correct relations", () => {
      const context = createBaseContext();
      const result = buildIssuesQuery(context, 0, 10);

      expect(result.include?.project).toBeDefined();
      expect(result.include?.createdBy).toBe(true);
    });
  });

  describe("buildMilestonesQuery", () => {
    it("should build query with isDeleted false", () => {
      const context = createBaseContext({ projectId: 30 });
      const result = buildMilestonesQuery(context, 0, 10);

      expect(result.where?.isDeleted).toBe(false);
      expect(result.where?.projectId).toBe(30);
    });

    it("should apply creator dimension filter", () => {
      const context = createBaseContext({
        dimensions: { creator: { id: "milestone-creator", name: "Creator" } },
      });
      const result = buildMilestonesQuery(context, 0, 10);

      expect(result.where?.createdBy).toBe("milestone-creator");
    });

    it("should apply milestone dimension filter", () => {
      const context = createBaseContext({
        dimensions: { milestone: { id: 50, name: "Milestone 50" } },
      });
      const result = buildMilestonesQuery(context, 0, 10);

      expect(result.where?.id).toBe(50);
    });

    it("should handle null milestone id", () => {
      const context = createBaseContext({
        dimensions: { milestone: { id: null as any, name: "None" } },
      });
      const result = buildMilestonesQuery(context, 0, 10);

      expect(result.where?.id).toBe(-1);
    });

    it("should filter active milestones for activeMilestones metric", () => {
      const context = createBaseContext({ metricId: "activeMilestones" });
      const result = buildMilestonesQuery(context, 0, 10);

      expect(result.where?.isStarted).toBe(true);
      expect(result.where?.isCompleted).toBe(false);
    });

    it("should include correct relations", () => {
      const context = createBaseContext();
      const result = buildMilestonesQuery(context, 0, 10);

      expect(result.include?.project).toBeDefined();
      expect(result.include?.milestoneType).toBeDefined();
      expect(result.include?.creator).toBeDefined();
    });
  });

  describe("buildMilestoneCompletionQuery", () => {
    it("should build query with testRun filter", () => {
      const context = createBaseContext({ projectId: 35 });
      const result = buildMilestoneCompletionQuery(context, 0, 10);

      expect(result.where?.testRun?.projectId).toBe(35);
      expect(result.where?.testRun?.isDeleted).toBe(false);
    });

    it("should apply milestone dimension filter", () => {
      const context = createBaseContext({
        dimensions: { milestone: { id: 60, name: "Milestone 60" } },
      });
      const result = buildMilestoneCompletionQuery(context, 0, 10);

      expect(result.where?.testRun?.milestoneId).toBe(60);
    });

    it("scopes to live milestones and live run-cases", () => {
      // The metric only aggregates runs attached to live milestones, so a
      // "None" milestone population cannot exist and every drill-down keeps
      // the same scoping.
      const context = createBaseContext({
        dimensions: { milestone: { id: null as any, name: "None" } },
      });
      const result = buildMilestoneCompletionQuery(context, 0, 10);

      expect(result.where?.testRun?.milestoneId).toBeUndefined();
      expect(result.where?.testRun?.milestone).toMatchObject({
        isDeleted: false,
      });
      expect(result.where?.isDeleted).toBe(false);
    });

    it("applies the report-level date range to the milestone creation date", () => {
      const context = createBaseContext({
        startDate: "2026-01-01",
        endDate: "2026-02-01",
      });
      const result = buildMilestoneCompletionQuery(context, 0, 10);

      // The end day is included in full — exclusive next-day bound.
      expect((result.where?.testRun?.milestone as any)?.createdAt).toEqual({
        gte: new Date("2026-01-01T00:00:00.000Z"),
        lt: new Date("2026-02-02T00:00:00.000Z"),
      });
    });

    it("should apply creator dimension filter", () => {
      const context = createBaseContext({
        dimensions: { creator: { id: "ms-creator", name: "Creator" } },
      });
      const result = buildMilestoneCompletionQuery(context, 0, 10);

      expect(result.where?.testRun?.milestone?.createdBy).toBe("ms-creator");
    });

    it("should include correct relations", () => {
      const context = createBaseContext();
      const result = buildMilestoneCompletionQuery(context, 0, 10);

      expect(result.include?.repositoryCase).toBeDefined();
      expect(result.include?.testRun).toBeDefined();
      expect(result.include?.status).toBeDefined();
    });

    it("should order by test case order", () => {
      const context = createBaseContext();
      const result = buildMilestoneCompletionQuery(context, 0, 10);

      expect(result.orderBy).toEqual({ order: "asc" });
    });
  });

  describe("getQueryBuilderForMetric", () => {
    describe("milestone metrics", () => {
      it("should return buildMilestonesQuery for totalMilestones", () => {
        const builder = getQueryBuilderForMetric("totalMilestones");
        expect(builder).toBe(buildMilestonesQuery);
      });

      it("should return buildMilestonesQuery for activeMilestones", () => {
        const builder = getQueryBuilderForMetric("activeMilestones");
        expect(builder).toBe(buildMilestonesQuery);
      });

      it("should return buildMilestoneCompletionQuery for milestoneCompletion", () => {
        const builder = getQueryBuilderForMetric("milestoneCompletion");
        expect(builder).toBe(buildMilestoneCompletionQuery);
      });
    });

    describe("test execution metrics", () => {
      it.each([
        "testResults",
        "passRate",
        "avgElapsed",
        "avgElapsedTime",
        "averageElapsed",
        "sumElapsed",
        "totalElapsedTime",
        "executionCount",
        "testResultCount",
      ])("should return buildTestExecutionQuery for %s", (metricId) => {
        const builder = getQueryBuilderForMetric(metricId);
        expect(builder).toBe(buildTestExecutionQuery);
      });
    });

    describe("test run metrics", () => {
      it.each(["testRuns", "testRunCount"])(
        "should return buildTestRunsQuery for %s",
        (metricId) => {
          const builder = getQueryBuilderForMetric(metricId);
          expect(builder).toBe(buildTestRunsQuery);
        }
      );
    });

    describe("repository stats metrics", () => {
      it.each([
        "automatedCount",
        "manualCount",
        "totalSteps",
        "averageSteps",
        "avgStepsPerCase",
        "automationRate",
      ])("should return buildRepositoryStatsQuery for %s", (metricId) => {
        const builder = getQueryBuilderForMetric(metricId);
        expect(builder).toBe(buildRepositoryStatsQuery);
      });
    });

    describe("test case metrics", () => {
      it("should return buildTestCasesQuery for test-execution reports", () => {
        const builder = getQueryBuilderForMetric("testCases", "test-execution");
        expect(builder).toBe(buildTestCasesQuery);
      });

      it("should return buildRepositoryStatsQuery for repository-stats reports", () => {
        const builder = getQueryBuilderForMetric(
          "testCaseCount",
          "repository-stats"
        );
        expect(builder).toBe(buildRepositoryStatsQuery);
      });

      it("should return buildRepositoryStatsQuery for user-engagement reports", () => {
        const builder = getQueryBuilderForMetric(
          "createdCaseCount",
          "user-engagement"
        );
        expect(builder).toBe(buildRepositoryStatsQuery);
      });
    });

    describe("session metrics", () => {
      it.each([
        "sessions",
        "sessionCount",
        "activeSessions",
        "averageDuration",
        "totalDuration",
      ])("should return buildSessionsQuery for %s", (metricId) => {
        const builder = getQueryBuilderForMetric(metricId);
        expect(builder).toBe(buildSessionsQuery);
      });

      it("should return buildSessionResultsQuery for sessionResultCount", () => {
        const builder = getQueryBuilderForMetric("sessionResultCount");
        expect(builder).toBe(buildSessionResultsQuery);
      });
    });

    describe("issue metrics", () => {
      it.each(["issues", "issueCount"])(
        "should return buildIssuesQuery for %s",
        (metricId) => {
          const builder = getQueryBuilderForMetric(metricId);
          expect(builder).toBe(buildIssuesQuery);
        }
      );
    });

    it("should default to buildTestExecutionQuery for unknown metrics", () => {
      const builder = getQueryBuilderForMetric("unknownMetric");
      expect(builder).toBe(buildTestExecutionQuery);
    });
  });

  describe("getModelForMetric", () => {
    describe("milestone metrics", () => {
      it("should return milestones for totalMilestones", () => {
        expect(getModelForMetric("totalMilestones")).toBe("milestones");
      });

      it("should return milestones for activeMilestones", () => {
        expect(getModelForMetric("activeMilestones")).toBe("milestones");
      });

      it("should return testRunCases for milestoneCompletion", () => {
        expect(getModelForMetric("milestoneCompletion")).toBe("testRunCases");
      });
    });

    describe("test execution metrics", () => {
      it.each([
        "testResults",
        "passRate",
        "avgElapsed",
        "avgElapsedTime",
        "averageElapsed",
        "sumElapsed",
        "totalElapsedTime",
        "executionCount",
        "testResultCount",
      ])("should return testRunResults for %s", (metricId) => {
        expect(getModelForMetric(metricId)).toBe("testRunResults");
      });
    });

    describe("test run metrics", () => {
      it.each(["testRuns", "testRunCount"])(
        "should return testRuns for %s",
        (metricId) => {
          expect(getModelForMetric(metricId)).toBe("testRuns");
        }
      );
    });

    describe("repository case metrics", () => {
      it.each([
        "testCases",
        "testCaseCount",
        "createdCaseCount",
        "automatedCount",
        "manualCount",
        "totalSteps",
        "averageSteps",
        "avgStepsPerCase",
        "automationRate",
      ])("should return repositoryCases for %s", (metricId) => {
        expect(getModelForMetric(metricId)).toBe("repositoryCases");
      });
    });

    describe("session metrics", () => {
      it.each([
        "sessions",
        "sessionCount",
        "activeSessions",
        "averageDuration",
        "totalDuration",
      ])("should return sessions for %s", (metricId) => {
        expect(getModelForMetric(metricId)).toBe("sessions");
      });

      it("should return sessionResults for sessionResultCount", () => {
        expect(getModelForMetric("sessionResultCount")).toBe("sessionResults");
      });
    });

    describe("issue metrics", () => {
      it.each(["issues", "issueCount"])(
        "should return issue for %s",
        (metricId) => {
          expect(getModelForMetric(metricId)).toBe("issue");
        }
      );
    });

    it("should default to testRunResults for unknown metrics", () => {
      expect(getModelForMetric("unknownMetric")).toBe("testRunResults");
    });
  });

  describe("pagination", () => {
    it("should apply offset and limit correctly", () => {
      const context = createBaseContext();

      const result1 = buildTestExecutionQuery(context, 0, 25);
      expect(result1.skip).toBe(0);
      expect(result1.take).toBe(25);

      const result2 = buildTestExecutionQuery(context, 50, 100);
      expect(result2.skip).toBe(50);
      expect(result2.take).toBe(100);
    });
  });

  // User-engagement dimensions (role, group) filter on the executor /
  // submitter / creator across every builder its metrics reach.
  describe("role and group dimension filters", () => {
    it("buildTestExecutionQuery filters the executor by role and group", () => {
      const context = createBaseContext({
        reportType: "user-engagement",
        metricId: "executionCount",
        dimensions: {
          role: { id: 5, name: "QA" },
          group: { id: 9, name: "Web Team" },
        },
      });
      const result = buildTestExecutionQuery(context, 0, 10);

      expect(result.where?.executedBy).toEqual({
        roleId: 5,
        groups: { some: { groupId: 9 } },
      });
    });

    it("buildJunitResultQuery filters the submitter by role and group", () => {
      const context = createBaseContext({
        reportType: "user-engagement",
        metricId: "executionCount",
        dimensions: {
          role: { id: 5, name: "QA" },
          group: { id: 9, name: "Web Team" },
        },
      });
      const result = buildJunitResultQuery(context);

      expect(result?.where.createdBy).toEqual({
        roleId: 5,
        groups: { some: { groupId: 9 } },
      });
    });

    it("buildSessionResultsQuery filters live results by creator role/group", () => {
      const context = createBaseContext({
        reportType: "user-engagement",
        metricId: "sessionResultCount",
        dimensions: { role: { id: 5, name: "QA" } },
      });
      const result = buildSessionResultsQuery(context, 0, 10);

      expect(result.where?.isDeleted).toBe(false);
      expect(result.where?.createdBy).toEqual({ roleId: 5 });
    });

    it("buildRepositoryStatsQuery filters the case creator by role/group", () => {
      const context = createBaseContext({
        reportType: "user-engagement",
        metricId: "createdCaseCount",
        dimensions: { group: { id: 9, name: "Web Team" } },
      });
      const result = buildRepositoryStatsQuery(context, 0, 10);

      expect(result.where?.creator).toEqual({
        groups: { some: { groupId: 9 } },
      });
    });
  });

  describe("session-analysis dimension and metric handling", () => {
    it("buildSessionsQuery excludes deleted sessions and honors the session dimensions", () => {
      const context = createBaseContext({
        reportType: "session-analysis",
        metricId: "sessionCount",
        dimensions: {
          session: { id: 12, name: "Session 12" },
          assignedTo: { id: "user-9", name: "Sam" },
          milestone: { id: 3, name: "M3" },
          template: { id: 4, name: "T4" },
          state: { id: 6, name: "Open" },
          creator: { id: "user-1", name: "Alex" },
          date: { id: "d", createdAt: "2026-07-01T00:00:00.000Z" } as any,
        },
      });
      const result = buildSessionsQuery(context, 0, 10);

      expect(result.where?.isDeleted).toBe(false);
      expect(result.where?.id).toBe(12);
      expect(result.where?.assignedToId).toBe("user-9");
      expect(result.where?.milestoneId).toBe(3);
      expect(result.where?.templateId).toBe(4);
      expect(result.where?.stateId).toBe(6);
      expect(result.where?.createdById).toBe("user-1");
      expect((result.where?.createdAt as any)?.gte).toEqual(
        new Date("2026-07-01T00:00:00.000Z")
      );
    });

    it("activeSessions restricts to in-progress sessions and maps to the sessions model", () => {
      const context = createBaseContext({
        reportType: "session-analysis",
        metricId: "activeSessions",
        dimensions: {},
      });
      const result = buildSessionsQuery(context, 0, 10);

      expect(result.where?.isCompleted).toBe(false);
      expect(getQueryBuilderForMetric("activeSessions")).toBe(
        buildSessionsQuery
      );
      expect(getModelForMetric("activeSessions")).toBe("sessions");
    });
  });

  describe("issue-tracking dimension handling", () => {
    it("buildIssuesQuery excludes deleted issues and honors the issue dimensions", () => {
      const context = createBaseContext({
        reportType: "issue-tracking",
        metricId: "issueCount",
        dimensions: {
          creator: { id: "user-1", name: "Alex" },
          issueType: { id: "10001", name: "Bug" },
          issueTracker: { id: 4, name: "Jira" },
          issueStatus: { id: "Done", name: "Done" },
          priority: { id: "high", name: "High" },
          date: { id: "d", createdAt: "2026-07-01T00:00:00.000Z" } as any,
        },
      });
      const result = buildIssuesQuery(context, 0, 10);

      expect(result.where?.isDeleted).toBe(false);
      expect(result.where?.createdById).toBe("user-1");
      expect(result.where?.issueTypeName).toBe("Bug");
      expect(result.where?.integrationId).toBe(4);
      expect(result.where?.status).toBe("Done");
      expect(result.where?.priority).toEqual({
        equals: "high",
        mode: "insensitive",
      });
      expect((result.where?.createdAt as any)?.gte).toEqual(
        new Date("2026-07-01T00:00:00.000Z")
      );
    });

    it("maps null issueType/issueTracker ids to the Unspecified/Internal populations", () => {
      const context = createBaseContext({
        reportType: "issue-tracking",
        metricId: "issueCount",
        dimensions: {
          issueType: { id: null as any, name: "Unspecified" },
          issueTracker: { id: null as any, name: "Internal" },
        },
      });
      const result = buildIssuesQuery(context, 0, 10);

      expect(result.where?.issueTypeName).toBeNull();
      expect(result.where?.integrationId).toBeNull();
    });

    it("scopes to defect rows by default, with no dimension filters supplied", () => {
      const context = createBaseContext({
        reportType: "issue-tracking",
        metricId: "issueCount",
        dimensions: {},
      });
      const result = buildIssuesQuery(context, 0, 10);

      expect(result.where?.isRequirement).toBe(false);
    });

    it("keeps the defect-scope predicate when issueType, issueStatus, priority and date dimensions are all applied", () => {
      const context = createBaseContext({
        reportType: "issue-tracking",
        metricId: "issueCount",
        dimensions: {
          issueType: { id: "10001", name: "Bug" },
          issueStatus: { id: "Done", name: "Done" },
          priority: { id: "high", name: "High" },
          date: { id: "d", createdAt: "2026-07-01T00:00:00.000Z" } as any,
        },
      });
      const result = buildIssuesQuery(context, 0, 10);

      expect(result.where?.isRequirement).toBe(false);
      expect(result.where?.issueTypeName).toBe("Bug");
      expect(result.where?.status).toBe("Done");
    });

    it("carries the same role predicate the report-builder aggregate applies, so the drill-down list agrees with the count", () => {
      const context = createBaseContext({
        reportType: "issue-tracking",
        metricId: "issueCount",
      });
      const result = buildIssuesQuery(context, 0, 10);

      expect(result.where?.isRequirement).toBe(
        DEFECT_SCOPE_WHERE.isRequirement
      );
    });
  });

  // The whitelist must cover every dimension a registry can emit — a missing
  // entry would 400 legitimate drill-downs; an extra one would let a
  // silently-ignored filter through.
  describe("DRILL_DOWN_DIMENSIONS_BY_REPORT", () => {
    it.each([
      ["test-execution", createTestExecutionDimensionRegistry],
      ["user-engagement", createUserEngagementDimensionRegistry],
      ["issue-tracking", createIssueTrackingDimensionRegistry],
      ["repository-stats", createRepositoryStatsDimensionRegistry],
    ] as const)("covers every %s dimension id", (reportType, factory) => {
      // isProjectSpecific=false includes the cross-project project dimension.
      const registry = factory(false) as Record<string, any>;
      const ids = Object.values(registry)
        .filter(Boolean)
        .map((d: any) => d.id);
      const allowed = DRILL_DOWN_DIMENSIONS_BY_REPORT[reportType];
      expect(ids.length).toBeGreaterThan(0);
      ids.forEach((id: string) => {
        expect(allowed.has(id), `${reportType} whitelist missing ${id}`).toBe(
          true
        );
      });
    });
  });
});
