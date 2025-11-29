/**
 * E2E tests for report drill-down API functionality
 * Tests that all drill-down queries work correctly with proper Prisma field names
 */

import { test } from "./helpers/api-test-base";
import { expect } from "@playwright/test";

test.describe("Report Drill-Down API @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;

  /**
   * Helper function to generate a report and extract drill-down context
   */
  async function generateReportAndGetContext(
    request: any,
    endpoint: string,
    body: any,
    metricId: string
  ) {
    const response = await request.post(endpoint, { data: body });
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length === 0) {
      return null;
    }

    // Find the first result with a non-zero metric value
    const resultWithData = data.results.find((r: any) => {
      const metricValue = r[metricId];
      return metricValue && metricValue > 0;
    });

    if (!resultWithData) {
      return null;
    }

    // Extract dimension filters from the result row
    const dimensions: any = {};
    Object.keys(resultWithData).forEach((key) => {
      if (key !== metricId && typeof resultWithData[key] === "object") {
        dimensions[key] = resultWithData[key];
      }
    });

    return {
      metricId,
      metricLabel: metricId,
      metricValue: resultWithData[metricId],
      reportType: endpoint.split("/").pop() || "",
      mode: body.projectId ? "project" : "cross-project",
      projectId: body.projectId,
      dimensions,
      startDate: body.startDate,
      endDate: body.endDate,
    };
  }

  /**
   * Comprehensive helper to validate drill-down counts match report metrics
   * Tests multiple metrics for a given report and ensures drill-down totals match
   */
  async function validateReportDrillDownCounts(
    request: any,
    reportEndpoint: string,
    reportBody: any,
    metricsToValidate: string[],
    options: {
      validateAggregates?: boolean;
      skipIfNoData?: boolean;
    } = {}
  ) {
    const { validateAggregates = false, skipIfNoData = true } = options;

    // Generate the report
    const reportResponse = await request.post(reportEndpoint, {
      data: reportBody,
    });

    if (!reportResponse.ok()) {
      const errorText = await reportResponse.text();
      throw new Error(
        `Report endpoint ${reportEndpoint} returned ${reportResponse.status()}: ${errorText}`
      );
    }
    const reportData = await reportResponse.json();
    expect(reportData.results).toBeInstanceOf(Array);

    // Find a row with meaningful data (non-zero first metric)
    const rowWithData = reportData.results.find((r: any) => {
      const firstMetricValue = r[metricsToValidate[0]];
      return firstMetricValue && firstMetricValue > 0;
    });

    if (!rowWithData) {
      if (skipIfNoData) {
        return { skipped: true, reason: "No data found in report" };
      }
      throw new Error("No data found in report for validation");
    }

    // Extract dimensions from the row
    const dimensions: any = {};
    Object.keys(rowWithData).forEach((key) => {
      if (!metricsToValidate.includes(key) && typeof rowWithData[key] === "object") {
        dimensions[key] = rowWithData[key];
      }
    });

    const validationResults: any = {
      reportEndpoint,
      rowDimensions: dimensions,
      metrics: {},
    };

    // Validate each metric
    for (const metricId of metricsToValidate) {
      const reportMetricValue = rowWithData[metricId];

      // Skip metrics with null/undefined values
      if (reportMetricValue === null || reportMetricValue === undefined) {
        validationResults.metrics[metricId] = { skipped: true, reason: "Null value" };
        continue;
      }

      const context = {
        metricId,
        metricLabel: metricId,
        metricValue: reportMetricValue,
        reportType: reportEndpoint.split("/").pop() || "",
        mode: reportBody.projectId ? ("project" as const) : ("cross-project" as const),
        projectId: reportBody.projectId,
        dimensions,
        startDate: reportBody.startDate,
        endDate: reportBody.endDate,
      };

      const drillDownResponse = await request.post("/api/report-builder/drill-down", {
        data: {
          context,
          offset: 0,
          limit: 1000, // Fetch enough to verify total
        },
      });

      expect(drillDownResponse.ok()).toBeTruthy();
      const drillDownData = await drillDownResponse.json();

      // Validate the count matches
      expect(drillDownData.total).toBe(reportMetricValue);

      validationResults.metrics[metricId] = {
        reportValue: reportMetricValue,
        drillDownTotal: drillDownData.total,
        matched: drillDownData.total === reportMetricValue,
      };

      // Validate aggregates if requested (e.g., for passRate)
      if (validateAggregates && metricId === "passRate" && drillDownData.aggregates) {
        expect(drillDownData.aggregates).toHaveProperty("statusCounts");
        expect(drillDownData.aggregates).toHaveProperty("passRate");

        // Verify status counts add up to total
        const totalFromStatuses = drillDownData.aggregates.statusCounts.reduce(
          (sum: number, sc: any) => sum + sc.count,
          0
        );
        expect(totalFromStatuses).toBe(drillDownData.total);

        validationResults.metrics[metricId].aggregates = {
          statusCounts: drillDownData.aggregates.statusCounts,
          passRate: drillDownData.aggregates.passRate,
          totalFromStatuses,
        };
      }
    }

    return validationResults;
  }

  test.describe("Test Execution Drill-Down", () => {
    test("should drill down into testResults metric", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/test-execution",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user", "date"],
          metrics: ["testResults"],
        },
        "testResults"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: {
          context,
          offset: 0,
          limit: 50,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data).toHaveProperty("data");
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("hasMore");
      expect(Array.isArray(data.data)).toBe(true);

      if (data.data.length > 0) {
        const record = data.data[0];

        // Validate TestRunResults structure
        expect(record).toHaveProperty("id");
        expect(record).toHaveProperty("name");
        expect(record).toHaveProperty("testRunId");
        expect(record).toHaveProperty("testRunCaseId");
        expect(record).toHaveProperty("statusId");
        expect(record).toHaveProperty("executedById");
        expect(record).toHaveProperty("executedAt");

        // Validate nested relations
        expect(record).toHaveProperty("testRun");
        expect(record.testRun).toHaveProperty("id");
        expect(record.testRun).toHaveProperty("name");
        expect(record.testRun).toHaveProperty("configId");

        expect(record).toHaveProperty("testRunCase");
        expect(record.testRunCase).toHaveProperty("repositoryCase");
        expect(record.testRunCase.repositoryCase).toHaveProperty("id");
        expect(record.testRunCase.repositoryCase).toHaveProperty("name");

        expect(record).toHaveProperty("status");
        expect(record.status).toHaveProperty("name");
        expect(record.status).toHaveProperty("color");

        expect(record).toHaveProperty("executedBy");
        expect(record.executedBy).toHaveProperty("id");
        expect(record.executedBy).toHaveProperty("name");
      }
    });

    test("should drill down into testResults with configuration dimension", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/test-execution",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["configuration"],
          metrics: ["testResults"],
        },
        "testResults"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: {
          context,
          offset: 0,
          limit: 50,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      // Verify configuration filtering works (testRun.configId)
      if (data.data.length > 0 && context.dimensions.configuration) {
        const expectedConfigId = context.dimensions.configuration.id;
        data.data.forEach((record: any) => {
          if (record.testRun?.configId) {
            expect(record.testRun.configId).toBe(expectedConfigId);
          }
        });
      }
    });

    test("should handle pagination correctly", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/test-execution",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["date"],
          metrics: ["testResults"],
        },
        "testResults"
      );

      if (!context) {
        test.skip();
        return;
      }

      // First page
      const response1 = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 10 },
      });
      const data1 = await response1.json();

      // Second page
      const response2 = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 10, limit: 10 },
      });
      const data2 = await response2.json();

      // Verify pagination
      expect(data1.data.length).toBeLessThanOrEqual(10);
      expect(data2.data.length).toBeLessThanOrEqual(10);

      if (data1.data.length > 0 && data2.data.length > 0) {
        // Verify records are different
        expect(data1.data[0].id).not.toBe(data2.data[0].id);
      }

      // Verify total is consistent
      expect(data1.total).toBe(data2.total);
    });
  });

  test.describe("Test Run Drill-Down", () => {
    test("should drill down into executionCount metric", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/user-engagement",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["executionCount"],
        },
        "executionCount"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      if (data.data.length > 0) {
        const record = data.data[0];

        // Validate TestRuns structure
        expect(record).toHaveProperty("id");
        expect(record).toHaveProperty("name");
        expect(record).toHaveProperty("projectId");
        expect(record).toHaveProperty("stateId"); // Note: uses 'state', not 'status'
        expect(record).toHaveProperty("createdById");
        expect(record).toHaveProperty("createdAt");

        // Validate nested relations
        expect(record).toHaveProperty("project");
        expect(record.project).toHaveProperty("name");

        expect(record).toHaveProperty("status"); // This is actually 'state' relation
        expect(record.status).toHaveProperty("name");

        expect(record).toHaveProperty("createdBy");
        expect(record.createdBy).toHaveProperty("name");
      }
    });
  });

  test.describe("Test Case Drill-Down", () => {
    test("should drill down into testCaseCount metric", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/repository-stats",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["folder"],
          metrics: ["testCaseCount"],
        },
        "testCaseCount"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      if (data.data.length > 0) {
        const record = data.data[0];

        // Validate RepositoryCases structure
        expect(record).toHaveProperty("id");
        expect(record).toHaveProperty("name");
        expect(record).toHaveProperty("projectId");
        expect(record).toHaveProperty("priority");

        // Validate nested relations
        expect(record).toHaveProperty("project");
        expect(record.project).toHaveProperty("name");

        // Note: Uses 'state', not 'status'
        if (record.status) {
          expect(record.status).toHaveProperty("name");
        }
      }
    });
  });

  test.describe("Session Drill-Down", () => {
    test("should drill down into sessionCount metric", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/session-analysis",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["creator"],
          metrics: ["sessionCount"],
        },
        "sessionCount"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      if (data.data.length > 0) {
        const record = data.data[0];

        // Validate Sessions structure
        expect(record).toHaveProperty("id");
        expect(record).toHaveProperty("name");
        expect(record).toHaveProperty("projectId");
        expect(record).toHaveProperty("createdById");
        expect(record).toHaveProperty("createdAt");

        // Validate nested relations
        expect(record).toHaveProperty("project");
        expect(record.project).toHaveProperty("name");

        expect(record).toHaveProperty("createdBy");
        expect(record.createdBy).toHaveProperty("name");
      }
    });
  });

  test.describe("Issue Drill-Down", () => {
    test("should drill down into issueCount metric", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/issue-tracking",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["creator"],
          metrics: ["issueCount"],
        },
        "issueCount"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      if (data.data.length > 0) {
        const record = data.data[0];

        // Validate Issue structure
        expect(record).toHaveProperty("id");
        expect(record).toHaveProperty("name");
        expect(record).toHaveProperty("projectId");
        expect(record).toHaveProperty("createdById");
        expect(record).toHaveProperty("createdAt");

        // Validate nested relations
        expect(record).toHaveProperty("project");
        expect(record.project).toHaveProperty("name");

        expect(record).toHaveProperty("createdBy");
        expect(record.createdBy).toHaveProperty("name");
      }
    });
  });

  test.describe("Cross-Project Drill-Down", () => {
    test("should drill down into cross-project test execution", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/cross-project-test-execution",
        {
          dimensions: ["project", "user"],
          metrics: ["testResults"],
        },
        "testResults"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      // Verify project dimension filtering works in cross-project mode
      if (data.data.length > 0 && context.dimensions.project) {
        const expectedProjectId = context.dimensions.project.id;
        data.data.forEach((record: any) => {
          expect(record.testRun?.projectId).toBe(expectedProjectId);
        });
      }
    });

    test("should drill down into cross-project user engagement", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/cross-project-user-engagement",
        {
          dimensions: ["project"],
          metrics: ["executionCount"],
        },
        "executionCount"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      if (data.data.length > 0 && context.dimensions.project) {
        const expectedProjectId = context.dimensions.project.id;
        data.data.forEach((record: any) => {
          expect(record.projectId).toBe(expectedProjectId);
        });
      }
    });
  });

  test.describe("Error Handling", () => {
    test.skip("should return 401 for unauthenticated requests", async ({ request }) => {
      // Note: Cannot test unauthenticated requests in Playwright E2E tests
      // as the request context shares authentication cookies.
      // This test would require a separate unauthenticated browser context.
    });

    test("should return 400 for invalid context", async ({ request }) => {
      const response = await request.post("/api/report-builder/drill-down", {
        data: {
          context: {
            // Missing required fields
          },
          offset: 0,
          limit: 50,
        },
      });

      expect(response.status()).toBe(400);
    });

    test("should handle empty results gracefully", async ({ request }) => {
      const response = await request.post("/api/report-builder/drill-down", {
        data: {
          context: {
            metricId: "testResults",
            metricLabel: "Test Results",
            metricValue: 0,
            reportType: "test-execution",
            mode: "project",
            projectId: TEST_PROJECT_ID,
            dimensions: {
              user: { id: "nonexistent-user-id", name: "Ghost User" },
            },
            startDate: "2099-01-01T00:00:00.000Z",
            endDate: "2099-12-31T23:59:59.999Z",
          },
          offset: 0,
          limit: 50,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data.data).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.hasMore).toBe(false);
    });
  });

  test.describe("Metric-Specific Drill-Downs", () => {
    test("should drill down into passRate metric (same as testResults)", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/test-execution",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["status"],
          metrics: ["passRate"],
        },
        "passRate"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      // Should return TestRunResults
      if (data.data.length > 0) {
        expect(data.data[0]).toHaveProperty("testRunCaseId");
        expect(data.data[0]).toHaveProperty("executedAt");
      }
    });

    test("should drill down into avgElapsedTime metric (same as testResults)", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/test-execution",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["avgElapsedTime"],
        },
        "avgElapsedTime"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      // Should return TestRunResults with elapsed field
      if (data.data.length > 0) {
        expect(data.data[0]).toHaveProperty("elapsed");
      }
    });

    test("should drill down into averageDuration metric (same as sessions)", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/session-analysis",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["creator"],
          metrics: ["averageDuration"],
        },
        "averageDuration"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.data).toBeInstanceOf(Array);

      // Should return Sessions with duration field
      if (data.data.length > 0) {
        expect(data.data[0]).toHaveProperty("duration");
      }
    });
  });

  test.describe("Drill-Down Count Validation", () => {
    test("should validate test execution drill-down counts match report metrics", async ({ request }) => {
      // Generate test execution report with user dimension
      const reportResponse = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["testResults", "passRate"],
        },
      });

      expect(reportResponse.ok()).toBeTruthy();
      const reportData = await reportResponse.json();
      expect(reportData.results).toBeInstanceOf(Array);

      // Find a user with meaningful data
      const userWithData = reportData.results.find(
        (r: any) => r.testResults > 0
      );

      if (!userWithData) {
        test.skip();
        return;
      }

      const reportMetrics = {
        testResults: userWithData.testResults,
        passRate: userWithData.passRate,
      };

      // Test testResults drill-down
      const executionContext = {
        metricId: "testResults",
        metricLabel: "Test Results",
        metricValue: reportMetrics.testResults,
        reportType: "test-execution",
        mode: "project" as const,
        projectId: TEST_PROJECT_ID,
        dimensions: { user: userWithData.user },
      };

      const executionResponse = await request.post("/api/report-builder/drill-down", {
        data: {
          context: executionContext,
          offset: 0,
          limit: 1000, // Fetch all to verify total
        },
      });

      expect(executionResponse.ok()).toBeTruthy();
      const executionData = await executionResponse.json();
      expect(executionData.total).toBe(reportMetrics.testResults);

      // Test passRate drill-down (should have same count as testResults)
      const passRateContext = {
        metricId: "passRate",
        metricLabel: "Pass Rate (%)",
        metricValue: reportMetrics.passRate,
        reportType: "test-execution",
        mode: "project" as const,
        projectId: TEST_PROJECT_ID,
        dimensions: { user: userWithData.user },
      };

      const passRateResponse = await request.post("/api/report-builder/drill-down", {
        data: {
          context: passRateContext,
          offset: 0,
          limit: 1000,
        },
      });

      expect(passRateResponse.ok()).toBeTruthy();
      const passRateData = await passRateResponse.json();
      expect(passRateData.total).toBe(reportMetrics.testResults);

      // Verify aggregates are present for passRate
      expect(passRateData).toHaveProperty("aggregates");
      expect(passRateData.aggregates).toHaveProperty("statusCounts");
      expect(passRateData.aggregates).toHaveProperty("passRate");

      // Verify status counts add up to total
      const totalFromStatuses = passRateData.aggregates.statusCounts.reduce(
        (sum: number, sc: any) => sum + sc.count,
        0
      );
      expect(totalFromStatuses).toBe(passRateData.total);
    });

    test("should validate user engagement drill-down counts match report metrics", async ({ request }) => {
      const result = await validateReportDrillDownCounts(
        request,
        "/api/report-builder/user-engagement",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["executionCount", "createdCaseCount", "sessionResultCount"],
        },
        ["executionCount", "createdCaseCount", "sessionResultCount"]
      );

      if (result.skipped) {
        test.skip();
        return;
      }

      // All metrics should have matched
      Object.values(result.metrics).forEach((metric: any) => {
        expect(metric.matched).toBe(true);
      });
    });

    test("should validate repository stats drill-down counts match report metrics", async ({ request }) => {
      const result = await validateReportDrillDownCounts(
        request,
        "/api/report-builder/repository-stats",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["folder"],
          metrics: ["testCaseCount"],
        },
        ["testCaseCount"]
      );

      if (result.skipped) {
        test.skip();
        return;
      }

      expect(result.metrics.testCaseCount.matched).toBe(true);
    });

    test("should validate session analysis drill-down counts match report metrics", async ({ request }) => {
      const result = await validateReportDrillDownCounts(
        request,
        "/api/report-builder/session-analysis",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["creator"],
          metrics: ["sessionCount", "averageDuration", "totalDuration"],
        },
        ["sessionCount", "averageDuration", "totalDuration"]
      );

      if (result.skipped) {
        test.skip();
        return;
      }

      // All metrics should have matched
      Object.values(result.metrics).forEach((metric: any) => {
        if (!metric.skipped) {
          expect(metric.matched).toBe(true);
        }
      });
    });

    test("should validate issue tracking drill-down counts match report metrics", async ({ request }) => {
      const result = await validateReportDrillDownCounts(
        request,
        "/api/report-builder/issue-tracking",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["creator"],
          metrics: ["issueCount"],
        },
        ["issueCount"]
      );

      if (result.skipped) {
        test.skip();
        return;
      }

      expect(result.metrics.issueCount.matched).toBe(true);
    });

    test("should validate cross-project test execution drill-down counts", async ({ request }) => {
      const result = await validateReportDrillDownCounts(
        request,
        "/api/report-builder/cross-project-test-execution",
        {
          dimensions: ["project"],
          metrics: ["testResults", "passRate"],
        },
        ["testResults", "passRate"],
        { validateAggregates: true }
      );

      if (result.skipped) {
        test.skip();
        return;
      }

      // Both metrics should have matched
      expect(result.metrics.testResults.matched).toBe(true);
      expect(result.metrics.passRate.matched).toBe(true);

      // passRate should have aggregates
      if (result.metrics.passRate.aggregates) {
        expect(result.metrics.passRate.aggregates.totalFromStatuses).toBe(
          result.metrics.passRate.drillDownTotal
        );
      }
    });

    test("should validate cross-project user engagement drill-down counts", async ({ request }) => {
      const result = await validateReportDrillDownCounts(
        request,
        "/api/report-builder/cross-project-user-engagement",
        {
          dimensions: ["project"],
          metrics: ["executionCount", "sessionResultCount"],
        },
        ["executionCount", "sessionResultCount"]
      );

      if (result.skipped) {
        test.skip();
        return;
      }

      // All metrics should have matched
      Object.values(result.metrics).forEach((metric: any) => {
        if (!metric.skipped) {
          expect(metric.matched).toBe(true);
        }
      });
    });

    test("should validate test execution with multiple dimensions", async ({ request }) => {
      const result = await validateReportDrillDownCounts(
        request,
        "/api/report-builder/test-execution",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user", "status"],
          metrics: ["testResults"],
        },
        ["testResults"]
      );

      if (result.skipped) {
        test.skip();
        return;
      }

      expect(result.metrics.testResults.matched).toBe(true);
    });

    test("should validate test execution with elapsed time metrics", async ({ request }) => {
      const result = await validateReportDrillDownCounts(
        request,
        "/api/report-builder/test-execution",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["testResults", "avgElapsedTime", "totalElapsedTime"],
        },
        ["testResults", "avgElapsedTime", "totalElapsedTime"]
      );

      if (result.skipped) {
        test.skip();
        return;
      }

      // testResults and both elapsed time metrics should use same underlying records
      expect(result.metrics.testResults.matched).toBe(true);
      expect(result.metrics.avgElapsedTime.matched).toBe(true);
      expect(result.metrics.totalElapsedTime.matched).toBe(true);

      // All three should have the same drill-down total (same records)
      expect(result.metrics.testResults.drillDownTotal).toBe(
        result.metrics.avgElapsedTime.drillDownTotal
      );
      expect(result.metrics.testResults.drillDownTotal).toBe(
        result.metrics.totalElapsedTime.drillDownTotal
      );
    });
  });

  test.describe("Date Filtering", () => {
    test("should respect report-level date range", async ({ request }) => {
      const startDate = "2024-01-01T00:00:00.000Z";
      const endDate = "2024-12-31T23:59:59.999Z";

      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/test-execution",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["testResults"],
          startDate,
          endDate,
        },
        "testResults"
      );

      if (!context) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      // Verify all records fall within date range
      if (data.data.length > 0) {
        data.data.forEach((record: any) => {
          const executedAt = new Date(record.executedAt);
          expect(executedAt.getTime()).toBeGreaterThanOrEqual(new Date(startDate).getTime());
          expect(executedAt.getTime()).toBeLessThanOrEqual(new Date(endDate).getTime());
        });
      }
    });

    test("should respect dimension-level date filter", async ({ request }) => {
      const context = await generateReportAndGetContext(
        request,
        "/api/report-builder/test-execution",
        {
          projectId: TEST_PROJECT_ID,
          dimensions: ["date"],
          metrics: ["testResults"],
        },
        "testResults"
      );

      if (!context || !context.dimensions.date) {
        test.skip();
        return;
      }

      const response = await request.post("/api/report-builder/drill-down", {
        data: { context, offset: 0, limit: 50 },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      // Verify all records are from the same day
      if (data.data.length > 0) {
        const expectedDate = new Date(context.dimensions.date.executedAt);
        const expectedDateStr = expectedDate.toISOString().split("T")[0];

        data.data.forEach((record: any) => {
          const executedAt = new Date(record.executedAt);
          const recordDateStr = executedAt.toISOString().split("T")[0];
          expect(recordDateStr).toBe(expectedDateStr);
        });
      }
    });
  });
});
