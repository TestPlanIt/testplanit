import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  buildTestExecutionQuery,
  buildTestRunsQuery,
  buildRepositoryStatsQuery,
  buildTestCasesQuery,
  buildSessionsQuery,
  buildSessionResultsQuery,
  buildIssuesQuery,
  buildMilestonesQuery,
  buildMilestoneCompletionQuery,
  getQueryBuilderForMetric,
  getModelForMetric,
} from "./drillDownQueryBuilders";
import type { DrillDownContext } from "~/lib/types/reportDrillDown";

// Helper to create a base context
function createBaseContext(overrides: Partial<DrillDownContext> = {}): DrillDownContext {
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

      expect(result.where?.testRun).toEqual({ projectId: 5 });
      expect(result.skip).toBe(0);
      expect(result.take).toBe(10);
      expect(result.orderBy).toEqual({ executedAt: Prisma.SortOrder.desc });
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
      expect((result.where?.executedAt as any).lte).toBeInstanceOf(Date);
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

  describe("buildTestRunsQuery", () => {
    it("should build basic query with project filter", () => {
      const context = createBaseContext({ projectId: 5 });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.projectId).toBe(5);
      expect(result.skip).toBe(0);
      expect(result.take).toBe(10);
      expect(result.orderBy).toEqual({ createdAt: Prisma.SortOrder.desc });
    });

    it("should apply user dimension filter to results", () => {
      const context = createBaseContext({
        dimensions: { user: { id: "user-456", name: "User" } },
      });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.results).toEqual({
        some: { executedById: "user-456" },
      });
    });

    it("should apply status dimension filter to results", () => {
      const context = createBaseContext({
        dimensions: { status: { id: 3, name: "Failed" } },
      });
      const result = buildTestRunsQuery(context, 0, 10);

      expect(result.where?.results).toEqual({
        some: { statusId: 3 },
      });
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

    it("should filter by testRun project, not RepositoryCases project", () => {
      const context = createBaseContext({ projectId: 10 });
      const result = buildTestCasesQuery(context, 0, 10);

      // Should be filtered through results.testRun, not directly on projectId
      expect(result.where?.projectId).toBeUndefined();
      expect(result.where?.testRuns).toBeDefined();
    });

    it("should apply user dimension filter to execution results", () => {
      const context = createBaseContext({
        dimensions: { user: { id: "exec-user", name: "Executor" } },
      });
      const result = buildTestCasesQuery(context, 0, 10);

      expect(result.where?.testRuns?.some?.results?.some?.executedById).toBe("exec-user");
    });

    it("should apply status dimension filter", () => {
      const context = createBaseContext({
        dimensions: { status: { id: 4, name: "Blocked" } },
      });
      const result = buildTestCasesQuery(context, 0, 10);

      expect(result.where?.testRuns?.some?.results?.some?.statusId).toBe(4);
    });

    it("should exclude untested for testCaseCount metric", () => {
      const context = createBaseContext({ metricId: "testCaseCount" });
      const result = buildTestCasesQuery(context, 0, 10);

      expect(result.where?.testRuns?.some?.results?.some?.status).toEqual({
        systemName: { not: "untested" },
      });
    });

    it("should apply date range filters to execution", () => {
      const context = createBaseContext({
        startDate: "2024-03-01",
        endDate: "2024-03-31",
      });
      const result = buildTestCasesQuery(context, 0, 10);

      expect(result.where?.testRuns?.some?.results?.some?.executedAt).toBeDefined();
    });
  });

  describe("buildSessionsQuery", () => {
    it("should build basic query with project filter", () => {
      const context = createBaseContext({ projectId: 12 });
      const result = buildSessionsQuery(context, 0, 10);

      expect(result.where?.projectId).toBe(12);
      expect(result.orderBy).toEqual({ createdAt: Prisma.SortOrder.desc });
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

    it("should handle null milestone", () => {
      const context = createBaseContext({
        dimensions: { milestone: { id: null as any, name: "None" } },
      });
      const result = buildMilestoneCompletionQuery(context, 0, 10);

      expect(result.where?.testRun?.milestoneId).toBeNull();
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

      expect(result.orderBy).toEqual({ order: Prisma.SortOrder.asc });
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
        const builder = getQueryBuilderForMetric("testCaseCount", "repository-stats");
        expect(builder).toBe(buildRepositoryStatsQuery);
      });

      it("should return buildRepositoryStatsQuery for user-engagement reports", () => {
        const builder = getQueryBuilderForMetric("createdCaseCount", "user-engagement");
        expect(builder).toBe(buildRepositoryStatsQuery);
      });
    });

    describe("session metrics", () => {
      it.each([
        "sessions",
        "sessionDuration",
        "sessionCount",
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
      it.each(["testRuns", "testRunCount"])("should return testRuns for %s", (metricId) => {
        expect(getModelForMetric(metricId)).toBe("testRuns");
      });
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
        "sessionDuration",
        "sessionCount",
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
      it.each(["issues", "issueCount"])("should return issue for %s", (metricId) => {
        expect(getModelForMetric(metricId)).toBe("issue");
      });
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
});
