/**
 * Comprehensive Report Drill-Down Count Validation Tests
 *
 * This test suite systematically validates that report aggregate counts
 * match their corresponding drill-down totals. It tests:
 *
 * 1. Every report type
 * 2. Every metric that supports drill-down
 * 3. Every dimension combination
 * 4. Multiple rows from each report
 *
 * When a mismatch is detected, it logs detailed information about:
 * - Which report and metric failed
 * - The dimension filters applied
 * - The expected vs actual counts
 * - The difference amount
 */

import { test } from "./helpers/api-test-base";
import { expect } from "@playwright/test";

// Test multiple projects to catch project-specific issues
const TEST_PROJECTS = [331, 370];

// Configuration for each report type
const REPORT_CONFIGS = {
  "test-execution": {
    endpoint: "/api/report-builder/test-execution",
    dimensions: [
      "user",
      "status",
      "testRun",
      "testCase",
      "configuration",
      "milestone",
      "date",
    ],
    metrics: [
      "testResults",
      "passRate",
      "avgElapsedTime",
      "totalElapsedTime",
      "testRunCount",
      "testCaseCount",
    ],
    drillDownMetrics: {
      testResults: "testResults",
      passRate: "passRate",
      avgElapsedTime: "avgElapsedTime",
      totalElapsedTime: "totalElapsedTime",
      testRunCount: "testRunCount",
      testCaseCount: "testCaseCount",
    },
  },
  "user-engagement": {
    endpoint: "/api/report-builder/user-engagement",
    dimensions: ["user", "role", "group", "date"],
    metrics: ["executionCount", "createdCaseCount", "sessionResultCount"],
    drillDownMetrics: {
      executionCount: "executionCount",
      createdCaseCount: "createdCaseCount",
      sessionResultCount: "sessionResultCount",
    },
  },
  "repository-stats": {
    endpoint: "/api/report-builder/repository-stats",
    dimensions: ["folder", "creator", "state", "template", "source", "date"],
    metrics: [
      "testCaseCount",
      "automatedCount",
      "manualCount",
      "totalSteps",
      "averageSteps",
      "automationRate",
    ],
    drillDownMetrics: {
      // Only count-based metrics can be validated via drilldown count
      testCaseCount: "testCaseCount",
      automatedCount: "automatedCount",
      manualCount: "manualCount",
      // Note: totalSteps, averageSteps, automationRate are aggregates
      // and cannot be validated via count comparison
    },
  },
  "session-analysis": {
    endpoint: "/api/report-builder/session-analysis",
    dimensions: [
      "session",
      "assignedTo",
      "milestone",
      "template",
      "state",
      "creator",
      "date",
    ],
    metrics: [
      "sessionCount",
      "completionRate",
      "totalDuration",
      "averageDuration",
    ],
    drillDownMetrics: {
      sessionCount: "sessionCount",
      totalDuration: "totalDuration",
      averageDuration: "averageDuration",
    },
  },
  "issue-tracking": {
    endpoint: "/api/report-builder/issue-tracking",
    dimensions: ["creator", "issueType", "state", "priority"],
    metrics: ["issueCount"],
    drillDownMetrics: {
      issueCount: "issueCount",
    },
  },
  "project-health": {
    endpoint: "/api/report-builder/project-health",
    dimensions: ["milestone", "creator", "date"],
    metrics: [
      "completionRate",
      "milestoneProgress",
      "totalMilestones",
      "activeMilestones",
    ],
    drillDownMetrics: {
      // Project health metrics typically don't support drilldown
    },
  },
} as const;

// Cross-project report configurations
const CROSS_PROJECT_CONFIGS = {
  "cross-project-test-execution": {
    endpoint: "/api/report-builder/cross-project-test-execution",
    dimensions: ["project", "user", "status"],
    metrics: ["testResults", "passRate"],
    drillDownMetrics: {
      testResults: "testResults",
      passRate: "passRate",
    },
  },
  "cross-project-user-engagement": {
    endpoint: "/api/report-builder/cross-project-user-engagement",
    dimensions: ["project", "user"],
    metrics: ["executionCount", "sessionResultCount"],
    drillDownMetrics: {
      executionCount: "executionCount",
      sessionResultCount: "sessionResultCount",
    },
  },
  "cross-project-repository-stats": {
    endpoint: "/api/report-builder/cross-project-repository-stats",
    dimensions: ["project", "date"],
    metrics: [
      "testCaseCount",
      "totalSteps",
      "averageSteps",
      "automatedCount",
      "manualCount",
      "automationRate",
    ],
    drillDownMetrics: {
      testCaseCount: "testCaseCount",
      automatedCount: "automatedCount",
      manualCount: "manualCount",
    },
  },
  "cross-project-issue-tracking": {
    endpoint: "/api/report-builder/cross-project-issue-tracking",
    dimensions: ["project", "creator", "issueType"],
    metrics: ["issueCount"],
    drillDownMetrics: {
      issueCount: "issueCount",
    },
  },
} as const;

interface ValidationError {
  reportType: string;
  projectId?: number;
  dimensions: any;
  metricId: string;
  reportValue: number;
  drillDownTotal: number;
  difference: number;
  percentDifference: number;
}

const validationErrors: ValidationError[] = [];

/**
 * Generate all combinations of dimensions (1, 2, 3, ... up to all dimensions)
 */
function generateAllDimensionCombinations(dimensions: string[]): string[][] {
  const combinations: string[][] = [];

  // Generate combinations of size 1 to dimensions.length
  for (let k = 1; k <= dimensions.length; k++) {
    // Generate all combinations of size k
    function combine(start: number, combo: string[]) {
      if (combo.length === k) {
        combinations.push([...combo]);
        return;
      }
      for (let i = start; i < dimensions.length; i++) {
        combo.push(dimensions[i]);
        combine(i + 1, combo);
        combo.pop();
      }
    }
    combine(0, []);
  }

  return combinations;
}

/**
 * Fetch actual dimensions and metrics from a report API endpoint
 */
async function fetchReportConfig(
  request: any,
  endpoint: string,
  projectId?: number
): Promise<{ dimensions: string[]; metrics: string[] }> {
  const url = projectId ? `${endpoint}?projectId=${projectId}` : endpoint;

  const response = await request.get(url);
  if (!response.ok()) {
    throw new Error(
      `Failed to fetch config from ${endpoint}: ${await response.text()}`
    );
  }

  const data = await response.json();
  const dimensions = data.dimensions
    ? data.dimensions.map((d: any) => d.id)
    : [];
  const metrics = data.metrics ? data.metrics.map((m: any) => m.id) : [];

  return { dimensions, metrics };
}

/**
 * Helper to extract dimension values from a report row
 */
function extractDimensions(
  row: any,
  dimensionKeys: string[],
  metricKeys: string[]
): Record<string, any> {
  const dimensions: Record<string, any> = {};

  for (const key of Object.keys(row)) {
    // Skip metric fields
    if (metricKeys.includes(key)) continue;

    // Include dimension fields
    if (
      dimensionKeys.includes(key) &&
      row[key] !== null &&
      row[key] !== undefined
    ) {
      dimensions[key] = row[key];
    }
  }

  return dimensions;
}

/**
 * Validate that a report metric matches its drill-down total
 * Note: Some metrics (like percentages, averages, sums) cannot be validated via count
 * and should be skipped
 */
async function validateMetricDrillDown(
  request: any,
  reportType: string,
  projectId: number | undefined,
  row: any,
  metricId: string,
  reportValue: number,
  dimensions: Record<string, any>,
  dateRange?: { startDate?: string; endDate?: string }
): Promise<boolean> {
  // Skip null/undefined/zero values
  if (reportValue === null || reportValue === undefined || reportValue === 0) {
    return true;
  }

  // Skip aggregate metrics that cannot be validated via count
  // These metrics calculate percentages, averages, or sums, not direct counts
  const aggregateMetrics = [
    "automationRate", // Percentage
    "totalSteps", // Sum of steps (not count of cases)
    "averageSteps", // Average (not count)
    "avgStepsPerCase", // Average (not count)
    "avgElapsedTime", // Average (not count)
    "totalElapsedTime", // Sum (not count)
    "avgElapsed", // Average (not count)
    "sumElapsed", // Sum (not count)
    "completionRate", // Percentage
    "averageDuration", // Average (not count)
    "totalDuration", // Sum (not count)
    // Note: passRate is validated by comparing drilldown count to testResults count
    // (not to the passRate percentage value)
  ];

  if (aggregateMetrics.includes(metricId)) {
    // For aggregate metrics, we can't validate via count comparison
    // They would need custom validation logic
    return true; // Skip validation for now
  }

  // Build drill-down context
  const context = {
    metricId,
    metricLabel: metricId,
    metricValue: reportValue,
    reportType,
    mode: projectId ? ("project" as const) : ("cross-project" as const),
    projectId,
    dimensions,
    startDate: dateRange?.startDate,
    endDate: dateRange?.endDate,
  };

  // Fetch drill-down data
  const drillDownResponse = await request.post(
    "/api/report-builder/drill-down",
    {
      data: {
        context,
        offset: 0,
        limit: 10000, // Fetch enough to get accurate total
      },
    }
  );

  if (!drillDownResponse.ok()) {
    const errorText = await drillDownResponse.text();
    console.error(
      `❌ Drill-down API failed for ${reportType} - ${metricId}: ${errorText}`
    );
    return false;
  }

  const drillDownData = await drillDownResponse.json();
  const drillDownTotal = drillDownData.total;

  // Check if counts match
  if (drillDownTotal !== reportValue) {
    const difference = drillDownTotal - reportValue;
    const percentDifference =
      reportValue > 0 ? (difference / reportValue) * 100 : 100;

    validationErrors.push({
      reportType,
      projectId,
      dimensions,
      metricId,
      reportValue,
      drillDownTotal,
      difference,
      percentDifference,
    });

    console.error(
      `\n❌ COUNT MISMATCH DETECTED:\n` +
        `   Report: ${reportType}\n` +
        `   Project: ${projectId || "cross-project"}\n` +
        `   Metric: ${metricId}\n` +
        `   Dimensions: ${JSON.stringify(dimensions, null, 2)}\n` +
        `   Report Value: ${reportValue}\n` +
        `   Drill-down Total: ${drillDownTotal}\n` +
        `   Difference: ${difference} (${percentDifference.toFixed(2)}%)\n`
    );

    return false;
  }

  return true;
}

/**
 * Test a report with specific dimension combination
 */
async function testReportDimensionCombo(
  request: any,
  reportType: string,
  config: any,
  projectId: number | undefined,
  dimensionCombo: string[],
  maxRowsToTest: number = 10
) {
  const reportBody: any = {
    dimensions: dimensionCombo,
    metrics: Object.keys(config.drillDownMetrics),
  };

  if (projectId) {
    reportBody.projectId = projectId;
  }

  // Generate report
  const reportResponse = await request.post(config.endpoint, {
    data: reportBody,
  });

  if (!reportResponse.ok()) {
    const errorText = await reportResponse.text();
    throw new Error(`Report generation failed: ${errorText}`);
  }

  const reportData = await reportResponse.json();

  if (!reportData.results || reportData.results.length === 0) {
    // No data for this combination - skip
    return { tested: 0, passed: 0, skipped: true };
  }

  // Test up to maxRowsToTest rows
  const rowsToTest = reportData.results.slice(0, maxRowsToTest);
  let testedCount = 0;
  let passedCount = 0;

  for (const row of rowsToTest) {
    // Extract dimensions from row
    const dimensions = extractDimensions(
      row,
      dimensionCombo,
      Object.keys(config.drillDownMetrics)
    );

    // Test each metric that supports drill-down
    for (const [metricKey, metricId] of Object.entries(
      config.drillDownMetrics
    )) {
      const reportValue = row[metricKey];

      if (reportValue && typeof reportValue === "number" && reportValue > 0) {
        testedCount++;

        const passed = await validateMetricDrillDown(
          request,
          reportType,
          projectId,
          row,
          metricId as string,
          reportValue,
          dimensions
        );

        if (passed) {
          passedCount++;
        }
      }
    }
  }

  return { tested: testedCount, passed: passedCount, skipped: false };
}

test.describe("Report Drill-Down Count Validation @api @reports @validation", () => {
  // COMPREHENSIVE AUTOMATED TESTING
  // This test suite systematically validates EVERY dimension + metric combination
  // to catch bugs like missing filters, untested status inclusion, NULL handling, etc.
  test.describe("Comprehensive Dimension + Metric Validation", () => {
    // Test every dimension with every drilldown metric for test-execution reports
    test("test-execution: validate ALL dimension + metric combinations", async ({
      request,
    }) => {
      test.setTimeout(600000); // 10 minutes for comprehensive testing

      const projectId = 370;
      const reportType = "test-execution";
      const config = REPORT_CONFIGS[reportType];

      const results: Array<{
        dimension: string;
        metric: string;
        passed: boolean;
        error?: string;
      }> = [];

      // Test each dimension individually with each metric
      for (const dimension of config.dimensions) {
        for (const [metricKey, metricId] of Object.entries(
          config.drillDownMetrics
        )) {
          try {
            // Generate report with this dimension and metric
            const reportBody = {
              projectId,
              dimensions: [dimension],
              metrics: [metricKey],
            };

            const reportResponse = await request.post(config.endpoint, {
              data: reportBody,
            });
            expect(reportResponse.ok()).toBeTruthy();
            const reportData = await reportResponse.json();

            if (reportData.results.length === 0) {
              results.push({
                dimension,
                metric: metricKey,
                passed: true,
                error: "No data (skipped)",
              });
              continue;
            }

            // Test first row with non-zero value
            const testRow = reportData.results.find(
              (row: any) =>
                row[metricKey] !== undefined &&
                row[metricKey] !== null &&
                row[metricKey] > 0
            );

            if (!testRow) {
              results.push({
                dimension,
                metric: metricKey,
                passed: true,
                error: "No non-zero values (skipped)",
              });
              continue;
            }

            const dimensions = extractDimensions(
              testRow,
              [dimension],
              [metricKey]
            );

            const passed = await validateMetricDrillDown(
              request,
              reportType,
              projectId,
              testRow,
              metricId,
              testRow[metricKey],
              dimensions
            );

            results.push({
              dimension,
              metric: metricKey,
              passed,
              error: passed ? undefined : "Count mismatch",
            });
          } catch (error: any) {
            results.push({
              dimension,
              metric: metricKey,
              passed: false,
              error: error.message,
            });
          }
        }
      }

      // Report results
      const failures = results.filter((r) => !r.passed);
      if (failures.length > 0) {
        console.log("\n❌ FAILURES:");
        failures.forEach((f) => {
          console.log(`  - ${f.dimension} + ${f.metric}: ${f.error}`);
        });
      }

      const passed = results.filter((r) => r.passed).length;
      console.log(
        `\n✅ Passed: ${passed}/${results.length} dimension+metric combinations`
      );

      // All combinations should pass
      expect(failures.length).toBe(0);
    });

    // Test with "None" values for dimensions that support NULL
    test("test-execution: validate NULL dimension values (configuration, milestone)", async ({
      request,
    }) => {
      test.setTimeout(300000);

      const projectId = 370;
      const reportType = "test-execution";
      const nullableDimensions = ["configuration", "milestone"];
      const metricsToTest = ["testRunCount", "testCaseCount", "testResults"];

      const results: Array<{
        dimension: string;
        metric: string;
        passed: boolean;
      }> = [];

      for (const dimension of nullableDimensions) {
        for (const metric of metricsToTest) {
          try {
            const reportBody = {
              projectId,
              dimensions: [dimension],
              metrics: [metric],
            };

            const reportResponse = await request.post(
              "/api/report-builder/test-execution",
              { data: reportBody }
            );
            const reportData = await reportResponse.json();

            // Find "None" row
            const noneRow = reportData.results.find(
              (row: any) =>
                row[dimension] &&
                row[dimension].name === "None" &&
                row[metric] &&
                row[metric] > 0
            );

            if (!noneRow) {
              results.push({ dimension, metric, passed: true }); // No None data, that's ok
              continue;
            }

            const dimensions = extractDimensions(
              noneRow,
              [dimension],
              [metric]
            );

            const passed = await validateMetricDrillDown(
              request,
              reportType,
              projectId,
              noneRow,
              metric,
              noneRow[metric],
              dimensions
            );

            results.push({ dimension, metric, passed });
          } catch (error) {
            results.push({ dimension, metric, passed: false });
          }
        }
      }

      const failures = results.filter((r) => !r.passed);
      expect(failures.length).toBe(0);
    });

    // Test multi-dimension combinations (would have caught configuration + status bugs)
    test("test-execution: validate common multi-dimension combinations", async ({
      request,
    }) => {
      test.setTimeout(300000);

      const projectId = 370;
      const reportType = "test-execution";

      const combinations = [
        { dims: ["status", "user"], metrics: ["testResults", "testRunCount"] },
        {
          dims: ["configuration", "status"],
          metrics: ["testResults", "passRate", "testRunCount", "testCaseCount"],
        },
        { dims: ["date", "status"], metrics: ["passRate", "testCaseCount"] },
        {
          dims: ["user", "configuration"],
          metrics: ["testResults", "testRunCount"],
        },
      ];

      const results: Array<{ combo: string; passed: boolean }> = [];

      for (const combo of combinations) {
        for (const metric of combo.metrics) {
          try {
            const reportBody = {
              projectId,
              dimensions: combo.dims,
              metrics: [metric],
            };

            const reportResponse = await request.post(
              "/api/report-builder/test-execution",
              { data: reportBody }
            );
            const reportData = await reportResponse.json();

            const testRow = reportData.results.find(
              (row: any) => row[metric] && row[metric] > 0
            );

            if (!testRow) {
              results.push({
                combo: `${combo.dims.join("+")} + ${metric}`,
                passed: true,
              });
              continue;
            }

            const dimensions = extractDimensions(testRow, combo.dims, [metric]);

            const passed = await validateMetricDrillDown(
              request,
              reportType,
              projectId,
              testRow,
              metric,
              testRow[metric],
              dimensions
            );

            results.push({
              combo: `${combo.dims.join("+")} + ${metric}`,
              passed,
            });
          } catch (error) {
            results.push({
              combo: `${combo.dims.join("+")} + ${metric}`,
              passed: false,
            });
          }
        }
      }

      const failures = results.filter((r) => !r.passed);
      if (failures.length > 0) {
        console.log("\n❌ Multi-dimension failures:");
        failures.forEach((f) => console.log(`  - ${f.combo}`));
      }

      expect(failures.length).toBe(0);
    });

    // Test other report types with the same comprehensive approach
    test("user-engagement: validate ALL dimension + metric combinations", async ({
      request,
    }) => {
      test.setTimeout(300000);

      const projectId = 370;
      const reportType = "user-engagement";
      const config = REPORT_CONFIGS[reportType];

      const results: Array<{
        dimension: string;
        metric: string;
        passed: boolean;
        error?: string;
      }> = [];

      for (const dimension of config.dimensions) {
        for (const [metricKey, metricId] of Object.entries(
          config.drillDownMetrics
        )) {
          try {
            const reportBody = {
              projectId,
              dimensions: [dimension],
              metrics: [metricKey],
            };

            const reportResponse = await request.post(config.endpoint, {
              data: reportBody,
            });
            expect(reportResponse.ok()).toBeTruthy();
            const reportData = await reportResponse.json();

            if (reportData.results.length === 0) {
              results.push({
                dimension,
                metric: metricKey,
                passed: true,
                error: "No data (skipped)",
              });
              continue;
            }

            const testRow = reportData.results.find(
              (row: any) =>
                row[metricKey] !== undefined &&
                row[metricKey] !== null &&
                row[metricKey] > 0
            );

            if (!testRow) {
              results.push({
                dimension,
                metric: metricKey,
                passed: true,
                error: "No non-zero values (skipped)",
              });
              continue;
            }

            const dimensions = extractDimensions(
              testRow,
              [dimension],
              [metricKey]
            );

            const passed = await validateMetricDrillDown(
              request,
              reportType,
              projectId,
              testRow,
              metricId,
              testRow[metricKey],
              dimensions
            );

            results.push({
              dimension,
              metric: metricKey,
              passed,
              error: passed ? undefined : "Count mismatch",
            });
          } catch (error: any) {
            results.push({
              dimension,
              metric: metricKey,
              passed: false,
              error: error.message,
            });
          }
        }
      }

      const failures = results.filter((r) => !r.passed);
      if (failures.length > 0) {
        console.log("\n❌ USER-ENGAGEMENT FAILURES:");
        failures.forEach((f) => {
          console.log(`  - ${f.dimension} + ${f.metric}: ${f.error}`);
        });
      }

      const passed = results.filter((r) => r.passed).length;
      console.log(
        `\n✅ User-Engagement Passed: ${passed}/${results.length} dimension+metric combinations`
      );

      expect(failures.length).toBe(0);
    });

    test("session-analysis: validate ALL dimension + metric combinations", async ({
      request,
    }) => {
      test.setTimeout(300000);

      const projectId = 370;
      const reportType = "session-analysis";
      const config = REPORT_CONFIGS[reportType];

      const results: Array<{
        dimension: string;
        metric: string;
        passed: boolean;
        error?: string;
      }> = [];

      for (const dimension of config.dimensions) {
        for (const [metricKey, metricId] of Object.entries(
          config.drillDownMetrics
        )) {
          try {
            const reportBody = {
              projectId,
              dimensions: [dimension],
              metrics: [metricKey],
            };

            const reportResponse = await request.post(config.endpoint, {
              data: reportBody,
            });
            expect(reportResponse.ok()).toBeTruthy();
            const reportData = await reportResponse.json();

            if (reportData.results.length === 0) {
              results.push({
                dimension,
                metric: metricKey,
                passed: true,
                error: "No data (skipped)",
              });
              continue;
            }

            const testRow = reportData.results.find(
              (row: any) =>
                row[metricKey] !== undefined &&
                row[metricKey] !== null &&
                row[metricKey] > 0
            );

            if (!testRow) {
              results.push({
                dimension,
                metric: metricKey,
                passed: true,
                error: "No non-zero values (skipped)",
              });
              continue;
            }

            const dimensions = extractDimensions(
              testRow,
              [dimension],
              [metricKey]
            );

            const passed = await validateMetricDrillDown(
              request,
              reportType,
              projectId,
              testRow,
              metricId,
              testRow[metricKey],
              dimensions
            );

            results.push({
              dimension,
              metric: metricKey,
              passed,
              error: passed ? undefined : "Count mismatch",
            });
          } catch (error: any) {
            results.push({
              dimension,
              metric: metricKey,
              passed: false,
              error: error.message,
            });
          }
        }
      }

      const failures = results.filter((r) => !r.passed);
      if (failures.length > 0) {
        console.log("\n❌ SESSION-ANALYSIS FAILURES:");
        failures.forEach((f) => {
          console.log(`  - ${f.dimension} + ${f.metric}: ${f.error}`);
        });
      }

      const passed = results.filter((r) => r.passed).length;
      console.log(
        `\n✅ Session-Analysis Passed: ${passed}/${results.length} dimension+metric combinations`
      );

      expect(failures.length).toBe(0);
    });

    test("repository-stats: validate ALL dimension + metric combinations", async ({
      request,
    }) => {
      test.setTimeout(300000);

      const projectId = 370;
      const reportType = "repository-stats";
      const config = REPORT_CONFIGS[reportType];

      const results: Array<{
        dimension: string;
        metric: string;
        passed: boolean;
        error?: string;
      }> = [];

      for (const dimension of config.dimensions) {
        for (const [metricKey, metricId] of Object.entries(
          config.drillDownMetrics
        )) {
          try {
            const reportBody = {
              projectId,
              dimensions: [dimension],
              metrics: [metricKey],
            };

            const reportResponse = await request.post(config.endpoint, {
              data: reportBody,
            });
            expect(reportResponse.ok()).toBeTruthy();
            const reportData = await reportResponse.json();

            if (reportData.results.length === 0) {
              results.push({
                dimension,
                metric: metricKey,
                passed: true,
                error: "No data (skipped)",
              });
              continue;
            }

            const testRow = reportData.results.find(
              (row: any) =>
                row[metricKey] !== undefined &&
                row[metricKey] !== null &&
                row[metricKey] > 0
            );

            if (!testRow) {
              results.push({
                dimension,
                metric: metricKey,
                passed: true,
                error: "No non-zero values (skipped)",
              });
              continue;
            }

            const dimensions = extractDimensions(
              testRow,
              [dimension],
              [metricKey]
            );

            const passed = await validateMetricDrillDown(
              request,
              reportType,
              projectId,
              testRow,
              metricId,
              testRow[metricKey],
              dimensions
            );

            results.push({
              dimension,
              metric: metricKey,
              passed,
              error: passed ? undefined : "Count mismatch",
            });
          } catch (error: any) {
            results.push({
              dimension,
              metric: metricKey,
              passed: false,
              error: error.message,
            });
          }
        }
      }

      const failures = results.filter((r) => !r.passed);
      if (failures.length > 0) {
        console.log("\n❌ REPOSITORY-STATS FAILURES:");
        failures.forEach((f) => {
          console.log(`  - ${f.dimension} + ${f.metric}: ${f.error}`);
        });
      }

      const passed = results.filter((r) => r.passed).length;
      console.log(
        `\n✅ Repository-Stats Passed: ${passed}/${results.length} dimension+metric combinations`
      );

      expect(failures.length).toBe(0);
    });

    // Test with "None" values for dimensions that support NULL (template, folder, state)
    test("repository-stats: validate NULL dimension values (template, folder, state)", async ({
      request,
    }) => {
      test.setTimeout(300000);

      const projectId = 370;
      const reportType = "repository-stats";
      const nullableDimensions = ["template", "folder", "state"];
      const metricsToTest = ["testCaseCount", "automatedCount", "manualCount"];

      const results: Array<{
        dimension: string;
        metric: string;
        passed: boolean;
      }> = [];

      for (const dimension of nullableDimensions) {
        for (const metric of metricsToTest) {
          try {
            const reportBody = {
              projectId,
              dimensions: [dimension],
              metrics: [metric],
            };

            const reportResponse = await request.post(
              "/api/report-builder/repository-stats",
              { data: reportBody }
            );
            const reportData = await reportResponse.json();

            // Find "None" row
            const noneRow = reportData.results.find(
              (row: any) =>
                row[dimension] &&
                row[dimension].name === "None" &&
                row[metric] &&
                row[metric] > 0
            );

            if (!noneRow) {
              results.push({ dimension, metric, passed: true }); // No None data, that's ok
              continue;
            }

            const dimensions = extractDimensions(
              noneRow,
              [dimension],
              [metric]
            );

            const passed = await validateMetricDrillDown(
              request,
              reportType,
              projectId,
              noneRow,
              metric,
              noneRow[metric],
              dimensions
            );

            results.push({ dimension, metric, passed });
          } catch (error) {
            results.push({ dimension, metric, passed: false });
          }
        }
      }

      const failures = results.filter((r) => !r.passed);
      if (failures.length > 0) {
        console.log("\n❌ REPOSITORY-STATS NULL DIMENSION FAILURES:");
        failures.forEach((f) => {
          console.log(`  - ${f.dimension} + ${f.metric}`);
        });
      }
      expect(failures.length).toBe(0);
    });

    // Test multi-dimension combinations (would catch similar bugs to test-execution)
    test("repository-stats: validate common multi-dimension combinations", async ({
      request,
    }) => {
      test.setTimeout(300000);

      const projectId = 370;
      const reportType = "repository-stats";

      const combinations = [
        {
          dims: ["folder", "state"],
          metrics: ["testCaseCount", "automatedCount"],
        },
        {
          dims: ["creator", "template"],
          metrics: ["testCaseCount", "manualCount"],
        },
        {
          dims: ["date", "state"],
          metrics: ["testCaseCount", "automatedCount"],
        },
        {
          dims: ["folder", "creator"],
          metrics: ["testCaseCount", "manualCount"],
        },
        {
          dims: ["template", "state"],
          metrics: ["testCaseCount", "automatedCount", "manualCount"],
        },
      ];

      const results: Array<{ combo: string; passed: boolean }> = [];

      for (const combo of combinations) {
        for (const metric of combo.metrics) {
          try {
            const reportBody = {
              projectId,
              dimensions: combo.dims,
              metrics: [metric],
            };

            const reportResponse = await request.post(
              "/api/report-builder/repository-stats",
              { data: reportBody }
            );
            const reportData = await reportResponse.json();

            const testRow = reportData.results.find(
              (row: any) => row[metric] && row[metric] > 0
            );

            if (!testRow) {
              results.push({
                combo: `${combo.dims.join("+")} + ${metric}`,
                passed: true,
              });
              continue;
            }

            const dimensions = extractDimensions(testRow, combo.dims, [metric]);

            const passed = await validateMetricDrillDown(
              request,
              reportType,
              projectId,
              testRow,
              metric,
              testRow[metric],
              dimensions
            );

            results.push({
              combo: `${combo.dims.join("+")} + ${metric}`,
              passed,
            });
          } catch (error) {
            results.push({
              combo: `${combo.dims.join("+")} + ${metric}`,
              passed: false,
            });
          }
        }
      }

      const failures = results.filter((r) => !r.passed);
      if (failures.length > 0) {
        console.log("\n❌ REPOSITORY-STATS Multi-dimension failures:");
        failures.forEach((f) => console.log(`  - ${f.combo}`));
      }

      expect(failures.length).toBe(0);
    });
  });

  // ULTRA-COMPREHENSIVE TESTING
  // Tests ALL report types with ALL dimension combinations and ALL metrics
  test.describe("Ultra-Comprehensive Report Testing", () => {
    const TEST_PROJECT_ID = 370;

    // Test all project-specific report types
    const projectReportTypes = [
      {
        type: "test-execution",
        endpoint: "/api/report-builder/test-execution",
      },
      {
        type: "repository-stats",
        endpoint: "/api/report-builder/repository-stats",
      },
      {
        type: "user-engagement",
        endpoint: "/api/report-builder/user-engagement",
      },
      {
        type: "session-analysis",
        endpoint: "/api/report-builder/session-analysis",
      },
      {
        type: "issue-tracking",
        endpoint: "/api/report-builder/issue-tracking",
      },
      {
        type: "project-health",
        endpoint: "/api/report-builder/project-health",
      },
    ];

    for (const reportType of projectReportTypes) {
      test(`${reportType.type}: test ALL dimension combinations with ALL metrics`, async ({
        request,
      }) => {
        test.setTimeout(1800000); // 30 minutes for ultra-comprehensive testing

        try {
          // Fetch actual dimensions and metrics from API
          const { dimensions, metrics } = await fetchReportConfig(
            request,
            reportType.endpoint,
            TEST_PROJECT_ID
          );

          if (dimensions.length === 0 || metrics.length === 0) {
            test.skip();
            return;
          }

          console.log(
            `\n📊 Testing ${reportType.type}: ${dimensions.length} dimensions, ${metrics.length} metrics`
          );

          // Generate ALL dimension combinations
          const dimensionCombinations =
            generateAllDimensionCombinations(dimensions);
          console.log(
            `   Generated ${dimensionCombinations.length} dimension combinations`
          );

          const results: Array<{
            dimensions: string[];
            passed: boolean;
            error?: string;
            testedMetrics: number;
          }> = [];

          // Test each dimension combination with ALL metrics
          for (const dimCombo of dimensionCombinations) {
            try {
              const reportBody = {
                projectId: TEST_PROJECT_ID,
                dimensions: dimCombo,
                metrics: metrics, // Always include ALL metrics
              };

              const reportResponse = await request.post(reportType.endpoint, {
                data: reportBody,
              });

              if (!reportResponse.ok()) {
                const errorText = await reportResponse.text();
                results.push({
                  dimensions: dimCombo,
                  passed: false,
                  error: `API error: ${errorText}`,
                  testedMetrics: 0,
                });
                continue;
              }

              const reportData = await reportResponse.json();

              if (!reportData.results || reportData.results.length === 0) {
                results.push({
                  dimensions: dimCombo,
                  passed: true,
                  error: "No data (skipped)",
                  testedMetrics: 0,
                });
                continue;
              }

              // Test drilldown for each metric that supports it
              let testedMetrics = 0;
              let passedMetrics = 0;

              for (const metric of metrics) {
                // Check if this metric supports drilldown
                const config =
                  REPORT_CONFIGS[
                    reportType.type as keyof typeof REPORT_CONFIGS
                  ];
                const drillDownMetricId =
                  config?.drillDownMetrics?.[
                    metric as keyof typeof config.drillDownMetrics
                  ];

                if (!drillDownMetricId) {
                  // Metric doesn't support drilldown, skip
                  continue;
                }

                // Find a row with non-zero value for this metric
                const testRow = reportData.results.find(
                  (row: any) =>
                    row[metric] !== undefined &&
                    row[metric] !== null &&
                    row[metric] > 0
                );

                if (!testRow) {
                  continue; // No data for this metric
                }

                testedMetrics++;

                const rowDimensions = extractDimensions(
                  testRow,
                  dimCombo,
                  metrics
                );

                const passed = await validateMetricDrillDown(
                  request,
                  reportType.type,
                  TEST_PROJECT_ID,
                  testRow,
                  drillDownMetricId,
                  testRow[metric],
                  rowDimensions
                );

                if (passed) {
                  passedMetrics++;
                }
              }

              results.push({
                dimensions: dimCombo,
                passed: testedMetrics === 0 || passedMetrics === testedMetrics,
                error:
                  testedMetrics > 0 && passedMetrics < testedMetrics
                    ? `${testedMetrics - passedMetrics}/${testedMetrics} metrics failed`
                    : undefined,
                testedMetrics,
              });
            } catch (error: any) {
              results.push({
                dimensions: dimCombo,
                passed: false,
                error: error.message,
                testedMetrics: 0,
              });
            }
          }

          // Report results
          const failures = results.filter((r) => !r.passed);
          const totalTested = results.filter((r) => r.testedMetrics > 0).length;
          const totalMetricsTested = results.reduce(
            (sum, r) => sum + r.testedMetrics,
            0
          );

          if (failures.length > 0) {
            console.log(`\n❌ ${reportType.type.toUpperCase()} FAILURES:`);
            failures.slice(0, 20).forEach((f) => {
              console.log(
                `  - [${f.dimensions.join(", ")}]: ${f.error || "Failed"}`
              );
            });
            if (failures.length > 20) {
              console.log(`  ... and ${failures.length - 20} more failures`);
            }
          }

          console.log(
            `\n✅ ${reportType.type}: ${results.length - failures.length}/${results.length} dimension combinations passed`
          );
          console.log(
            `   Tested ${totalTested} combinations with drilldown metrics (${totalMetricsTested} total metric tests)`
          );

          // Fail if there are any failures
          expect(failures.length).toBe(0);
        } catch (error: any) {
          console.error(`Error testing ${reportType.type}:`, error.message);
          throw error;
        }
      });
    }

    // Test cross-project report types
    const crossProjectReportTypes = [
      {
        type: "cross-project-test-execution",
        endpoint: "/api/report-builder/cross-project-test-execution",
      },
      {
        type: "cross-project-repository-stats",
        endpoint: "/api/report-builder/cross-project-repository-stats",
      },
      {
        type: "cross-project-user-engagement",
        endpoint: "/api/report-builder/cross-project-user-engagement",
      },
      {
        type: "cross-project-issue-tracking",
        endpoint: "/api/report-builder/cross-project-issue-tracking",
      },
    ];

    for (const reportType of crossProjectReportTypes) {
      test(`${reportType.type}: test ALL dimension combinations with ALL metrics`, async ({
        request,
      }) => {
        test.setTimeout(1800000); // 30 minutes

        try {
          // Fetch actual dimensions and metrics from API (no projectId for cross-project)
          const { dimensions, metrics } = await fetchReportConfig(
            request,
            reportType.endpoint
          );

          if (dimensions.length === 0 || metrics.length === 0) {
            test.skip();
            return;
          }

          console.log(
            `\n📊 Testing ${reportType.type}: ${dimensions.length} dimensions, ${metrics.length} metrics`
          );

          // Generate ALL dimension combinations
          const dimensionCombinations =
            generateAllDimensionCombinations(dimensions);
          console.log(
            `   Generated ${dimensionCombinations.length} dimension combinations`
          );

          const results: Array<{
            dimensions: string[];
            passed: boolean;
            error?: string;
            testedMetrics: number;
          }> = [];

          // Test each dimension combination with ALL metrics
          for (const dimCombo of dimensionCombinations) {
            try {
              const reportBody = {
                dimensions: dimCombo,
                metrics: metrics, // Always include ALL metrics
              };

              const reportResponse = await request.post(reportType.endpoint, {
                data: reportBody,
              });

              if (!reportResponse.ok()) {
                const errorText = await reportResponse.text();
                results.push({
                  dimensions: dimCombo,
                  passed: false,
                  error: `API error: ${errorText}`,
                  testedMetrics: 0,
                });
                continue;
              }

              const reportData = await reportResponse.json();

              if (!reportData.results || reportData.results.length === 0) {
                results.push({
                  dimensions: dimCombo,
                  passed: true,
                  error: "No data (skipped)",
                  testedMetrics: 0,
                });
                continue;
              }

              // Test drilldown for each metric that supports it
              let testedMetrics = 0;
              let passedMetrics = 0;

              for (const metric of metrics) {
                // Check if this metric supports drilldown
                const config =
                  CROSS_PROJECT_CONFIGS[
                    reportType.type as keyof typeof CROSS_PROJECT_CONFIGS
                  ];
                const drillDownMetricId =
                  config?.drillDownMetrics?.[
                    metric as keyof typeof config.drillDownMetrics
                  ];

                if (!drillDownMetricId) {
                  // Metric doesn't support drilldown, skip
                  continue;
                }

                // Find a row with non-zero value for this metric
                const testRow = reportData.results.find(
                  (row: any) =>
                    row[metric] !== undefined &&
                    row[metric] !== null &&
                    row[metric] > 0
                );

                if (!testRow) {
                  continue; // No data for this metric
                }

                testedMetrics++;

                const rowDimensions = extractDimensions(
                  testRow,
                  dimCombo,
                  metrics
                );

                const passed = await validateMetricDrillDown(
                  request,
                  reportType.type,
                  undefined, // No projectId for cross-project
                  testRow,
                  drillDownMetricId,
                  testRow[metric],
                  rowDimensions
                );

                if (passed) {
                  passedMetrics++;
                }
              }

              results.push({
                dimensions: dimCombo,
                passed: testedMetrics === 0 || passedMetrics === testedMetrics,
                error:
                  testedMetrics > 0 && passedMetrics < testedMetrics
                    ? `${testedMetrics - passedMetrics}/${testedMetrics} metrics failed`
                    : undefined,
                testedMetrics,
              });
            } catch (error: any) {
              results.push({
                dimensions: dimCombo,
                passed: false,
                error: error.message,
                testedMetrics: 0,
              });
            }
          }

          // Report results
          const failures = results.filter((r) => !r.passed);
          const totalTested = results.filter((r) => r.testedMetrics > 0).length;
          const totalMetricsTested = results.reduce(
            (sum, r) => sum + r.testedMetrics,
            0
          );

          if (failures.length > 0) {
            console.log(`\n❌ ${reportType.type.toUpperCase()} FAILURES:`);
            failures.slice(0, 20).forEach((f) => {
              console.log(
                `  - [${f.dimensions.join(", ")}]: ${f.error || "Failed"}`
              );
            });
            if (failures.length > 20) {
              console.log(`  ... and ${failures.length - 20} more failures`);
            }
          }

          console.log(
            `\n✅ ${reportType.type}: ${results.length - failures.length}/${results.length} dimension combinations passed`
          );
          console.log(
            `   Tested ${totalTested} combinations with drilldown metrics (${totalMetricsTested} total metric tests)`
          );

          // Fail if there are any failures
          expect(failures.length).toBe(0);
        } catch (error: any) {
          console.error(`Error testing ${reportType.type}:`, error.message);
          throw error;
        }
      });
    }
  });

  // LEGACY TESTS - Specific bug regression tests
  // These tests remain to document specific bugs and their fixes
  test.describe("Legacy Bug Regression Tests", () => {
    // Test project-level reports
    for (const projectId of TEST_PROJECTS) {
      test.describe(`Project ${projectId} Reports`, () => {
        for (const [reportType, config] of Object.entries(REPORT_CONFIGS)) {
          test.describe(reportType, () => {
            // Test single dimensions
            for (const dimension of config.dimensions) {
              test(`Single dimension: ${dimension}`, async ({ request }) => {
                test.setTimeout(120000); // 2 minutes

                const result = await testReportDimensionCombo(
                  request,
                  reportType,
                  config,
                  projectId,
                  [dimension],
                  5 // Test 5 rows per dimension
                );

                if (result.skipped) {
                  test.skip();
                  return;
                }

                expect(result.passed).toBe(result.tested);
              });
            }

            // Test two-dimension combinations (sample)
            const dimensionPairs = [
              [config.dimensions[0], config.dimensions[1]],
              [config.dimensions[1], config.dimensions[0]],
            ].filter((pair) => pair.every((d) => d !== undefined));

            for (const pair of dimensionPairs) {
              test(`Two dimensions: ${pair.join(" + ")}`, async ({
                request,
              }) => {
                test.setTimeout(120000);

                const result = await testReportDimensionCombo(
                  request,
                  reportType,
                  config,
                  projectId,
                  pair,
                  3 // Test 3 rows for two-dimension combos
                );

                if (result.skipped) {
                  test.skip();
                  return;
                }

                expect(result.passed).toBe(result.tested);
              });
            }

            // Test three dimensions (if available)
            if (config.dimensions.length >= 3) {
              const triple = [
                config.dimensions[0],
                config.dimensions[1],
                config.dimensions[2],
              ];

              test(`Three dimensions: ${triple.join(" + ")}`, async ({
                request,
              }) => {
                test.setTimeout(120000);

                const result = await testReportDimensionCombo(
                  request,
                  reportType,
                  config,
                  projectId,
                  triple,
                  2 // Test 2 rows for three-dimension combos
                );

                if (result.skipped) {
                  test.skip();
                  return;
                }

                expect(result.passed).toBe(result.tested);
              });
            }
          });
        }
      });
    }

    // Test cross-project reports
    test.describe("Cross-Project Reports", () => {
      for (const [reportType, config] of Object.entries(
        CROSS_PROJECT_CONFIGS
      )) {
        test.describe(reportType, () => {
          // Test single dimensions
          for (const dimension of config.dimensions) {
            test(`Single dimension: ${dimension}`, async ({ request }) => {
              test.setTimeout(120000);

              const result = await testReportDimensionCombo(
                request,
                reportType,
                config,
                undefined, // cross-project
                [dimension],
                5
              );

              if (result.skipped) {
                test.skip();
                return;
              }

              expect(result.passed).toBe(result.tested);
            });
          }

          // Test two-dimension combinations
          const dimensionPairs = [
            [config.dimensions[0], config.dimensions[1]],
          ].filter((pair) => pair.every((d) => d !== undefined));

          for (const pair of dimensionPairs) {
            test(`Two dimensions: ${pair.join(" + ")}`, async ({ request }) => {
              test.setTimeout(120000);

              const result = await testReportDimensionCombo(
                request,
                reportType,
                config,
                undefined,
                pair,
                3
              );

              if (result.skipped) {
                test.skip();
                return;
              }

              expect(result.passed).toBe(result.tested);
            });
          }
        });
      }
    });

    // Test with date filters
    test.describe("Date Filter Validation", () => {
      const projectId = TEST_PROJECTS[0];

      test("test-execution with date range", async ({ request }) => {
        test.setTimeout(120000);

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30); // Last 30 days

        const reportBody = {
          projectId,
          dimensions: ["user"],
          metrics: ["testResults"],
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Test first row
        const row = reportData.results[0];
        const dimensions = extractDimensions(row, ["user"], ["testResults"]);

        const passed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          row,
          "testResults",
          row.testResults,
          dimensions,
          { startDate: reportBody.startDate, endDate: reportBody.endDate }
        );

        expect(passed).toBe(true);
      });
    });

    // Test for status dimension with testRunCount metric
    //
    // BUG CAUGHT: This test suite catches a critical bug where testRunCount shows incorrect values
    // when grouped by status dimension.
    //
    // THE PROBLEM:
    // 1. Report calculation bug:
    //    - The testRunCount metric only had special handling for executedAt and executedById
    //    - When grouping by statusId, it would query TestRuns table directly
    //    - But TestRuns table doesn't have a statusId field! Status is on TestRunResults
    //    - This caused all test runs to be grouped incorrectly (showing 0 for most statuses)
    //
    // 2. Drilldown bug:
    //    - The buildTestRunsQuery filtered by TestRuns.state (test run state like "completed")
    //    - But the report groups by TestRunResults.statusId (result status like "passed", "failed")
    //    - These are completely different fields! state != status
    //    - This caused the drilldown to return different test runs than what the report counted
    //
    // THE FIX:
    // 1. Added statusId to the special case in testRunCount metric aggregation
    // 2. Query TestRunResults when grouping by statusId and count unique testRunIds
    // 3. In buildTestRunsQuery, apply status filter to results.statusId, not testRun.state
    //
    // BEFORE FIX: Report shows testRunCount=84 for "Passed", drilldown shows different count
    // AFTER FIX: Report and drilldown both correctly show 84 test runs with passed results
    //
    test.describe("Status Dimension with Test Run Count", () => {
      test("testRunCount should work correctly when grouped by status", async ({
        request,
      }) => {
        test.setTimeout(120000);

        // Use project 370 which is known to have test run data
        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["status"],
          metrics: ["testRunCount"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Test all status rows with non-zero testRunCount
        const rowsWithRuns = reportData.results.filter(
          (row: any) => row.testRunCount && row.testRunCount > 0
        );

        if (rowsWithRuns.length === 0) {
          test.skip();
          return;
        }

        let passedCount = 0;
        for (const row of rowsWithRuns) {
          const dimensions = extractDimensions(
            row,
            ["status"],
            ["testRunCount"]
          );

          const passed = await validateMetricDrillDown(
            request,
            "test-execution",
            projectId,
            row,
            "testRunCount",
            row.testRunCount,
            dimensions
          );

          if (passed) {
            passedCount++;
          }
        }

        // All rows should pass validation
        expect(passedCount).toBe(rowsWithRuns.length);
      });

      test("testRunCount and testCaseCount should both work with status dimension", async ({
        request,
      }) => {
        test.setTimeout(120000);

        // Use project 370 which is known to have test run data
        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["status"],
          metrics: ["testRunCount", "testCaseCount"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Find a status with both test runs and test cases
        const testRow = reportData.results.find(
          (row: any) =>
            row.testRunCount &&
            row.testRunCount > 0 &&
            row.testCaseCount &&
            row.testCaseCount > 0
        );

        if (!testRow) {
          test.skip();
          return;
        }

        const dimensions = extractDimensions(
          testRow,
          ["status"],
          ["testRunCount", "testCaseCount"]
        );

        // Validate both metrics
        const testRunPassed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          testRow,
          "testRunCount",
          testRow.testRunCount,
          dimensions
        );

        const testCasePassed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          testRow,
          "testCaseCount",
          testRow.testCaseCount,
          dimensions
        );

        expect(testRunPassed).toBe(true);
        expect(testCasePassed).toBe(true);
      });

      test("testRunCount should work with status + user dimensions", async ({
        request,
      }) => {
        test.setTimeout(120000);

        // Use project 370 which is known to have test run data
        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["status", "user"],
          metrics: ["testRunCount", "testResults"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Test first row with non-zero testRunCount
        const testRow = reportData.results.find(
          (row: any) => row.testRunCount && row.testRunCount > 0
        );

        if (!testRow) {
          test.skip();
          return;
        }

        const dimensions = extractDimensions(
          testRow,
          ["status", "user"],
          ["testRunCount"]
        );

        const passed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          testRow,
          "testRunCount",
          testRow.testRunCount,
          dimensions
        );

        expect(passed).toBe(true);
      });
    });

    // Test for configuration dimension with testRunCount metric
    //
    // BUG CAUGHT: This test suite catches a bug where testRunCount drilldown doesn't filter by configuration.
    //
    // THE PROBLEM:
    // - The report correctly groups test runs by configId (configuration is a TestRuns field)
    // - But the buildTestRunsQuery function had NO handling for the configuration dimension
    // - The drilldown would return ALL test runs regardless of configuration
    // - This caused report count != drilldown count
    //
    // THE FIX:
    // - Added configuration filter to buildTestRunsQuery:
    //   if (context.dimensions.configuration) {
    //     where.configId = Number(context.dimensions.configuration.id);
    //   }
    //
    // This is a simple missing filter bug that comprehensive dimension testing catches.
    //
    test.describe("Configuration Dimension with Test Run Count", () => {
      test("testRunCount should work correctly when grouped by configuration", async ({
        request,
      }) => {
        test.setTimeout(120000);

        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["configuration"],
          metrics: ["testRunCount"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Test all configuration rows with non-zero testRunCount
        const rowsWithRuns = reportData.results.filter(
          (row: any) => row.testRunCount && row.testRunCount > 0
        );

        if (rowsWithRuns.length === 0) {
          test.skip();
          return;
        }

        let passedCount = 0;
        for (const row of rowsWithRuns) {
          const dimensions = extractDimensions(
            row,
            ["configuration"],
            ["testRunCount"]
          );

          const passed = await validateMetricDrillDown(
            request,
            "test-execution",
            projectId,
            row,
            "testRunCount",
            row.testRunCount,
            dimensions
          );

          if (passed) {
            passedCount++;
          }
        }

        // All rows should pass validation
        expect(passedCount).toBe(rowsWithRuns.length);
      });

      test("testRunCount should work with configuration + status dimensions", async ({
        request,
      }) => {
        test.setTimeout(120000);

        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["configuration", "status"],
          metrics: ["testRunCount", "testResults"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Test first row with non-zero testRunCount
        const testRow = reportData.results.find(
          (row: any) => row.testRunCount && row.testRunCount > 0
        );

        if (!testRow) {
          test.skip();
          return;
        }

        const dimensions = extractDimensions(
          testRow,
          ["configuration", "status"],
          ["testRunCount"]
        );

        const passed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          testRow,
          "testRunCount",
          testRow.testRunCount,
          dimensions
        );

        expect(passed).toBe(true);
      });

      test("all metrics should work with configuration dimension", async ({
        request,
      }) => {
        test.setTimeout(120000);

        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["configuration"],
          metrics: ["testResults", "testRunCount", "testCaseCount", "passRate"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Find a row with data for all metrics
        const testRow = reportData.results.find(
          (row: any) =>
            row.testResults &&
            row.testResults > 0 &&
            row.testRunCount &&
            row.testRunCount > 0 &&
            row.testCaseCount &&
            row.testCaseCount > 0
        );

        if (!testRow) {
          test.skip();
          return;
        }

        const dimensions = extractDimensions(
          testRow,
          ["configuration"],
          ["testResults", "testRunCount", "testCaseCount"]
        );

        // Validate all count metrics
        const testResultsPassed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          testRow,
          "testResults",
          testRow.testResults,
          dimensions
        );

        const testRunsPassed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          testRow,
          "testRunCount",
          testRow.testRunCount,
          dimensions
        );

        const testCasesPassed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          testRow,
          "testCaseCount",
          testRow.testCaseCount,
          dimensions
        );

        expect(testResultsPassed).toBe(true);
        expect(testRunsPassed).toBe(true);
        expect(testCasesPassed).toBe(true);
      });

      test("testRunCount should work for Configuration: None", async ({
        request,
      }) => {
        test.setTimeout(120000);

        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["configuration"],
          metrics: ["testRunCount", "testCaseCount"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Find the "None" configuration row
        const noneRow = reportData.results.find(
          (row: any) =>
            row.configuration &&
            row.configuration.name === "None" &&
            row.testRunCount &&
            row.testRunCount > 0
        );

        if (!noneRow) {
          test.skip();
          return;
        }

        const dimensions = extractDimensions(
          noneRow,
          ["configuration"],
          ["testRunCount", "testCaseCount"]
        );

        // Validate both metrics for "None" configuration
        const testRunsPassed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          noneRow,
          "testRunCount",
          noneRow.testRunCount,
          dimensions
        );

        const testCasesPassed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          noneRow,
          "testCaseCount",
          noneRow.testCaseCount,
          dimensions
        );

        expect(testRunsPassed).toBe(true);
        expect(testCasesPassed).toBe(true);
      });
    });

    // Test for Pass Rate and Test Case Count with Date Dimension
    //
    // BUG CAUGHT: This test suite catches bugs where Pass Rate and Test Case Count calculations
    // included "untested" status results but drilldowns excluded them.
    //
    // THE PROBLEM:
    // 1. Pass Rate bug:
    //    - The Pass Rate report calculation queried all TestRunResults without excluding "untested"
    //    - This caused incorrect pass rate percentages (too low, diluted by untested results)
    //
    // 2. Test Case Count bug:
    //    - The Test Case Count report calculation also included "untested" status results
    //    - This caused the chart to show inflated numbers (e.g., 5,170) that didn't match the table
    //    - Dates with only "untested" results would appear in chart but not in drilldowns
    //
    // THE FIX:
    // - Added "status: { systemName: { not: 'untested' } }" filter to all calculation paths for:
    //   1. Pass Rate metric (3 code paths)
    //   2. Test Case Count metric (3 code paths)
    // - Now both metrics match their drilldowns
    //
    test.describe("Pass Rate and Test Case Count with Date Dimension", () => {
      test("passRate should exclude untested status when grouped by date", async ({
        request,
      }) => {
        test.setTimeout(120000);

        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["date"],
          metrics: ["passRate", "testResults"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Test first row with non-zero testResults
        const testRow = reportData.results.find(
          (row: any) => row.testResults && row.testResults > 0
        );

        if (!testRow) {
          test.skip();
          return;
        }

        const dimensions = extractDimensions(testRow, ["date"], ["passRate"]);

        // The pass rate drilldown should show the same records as testResults
        // because both should exclude "untested" status
        const passed = await validateMetricDrillDown(
          request,
          "test-execution",
          projectId,
          testRow,
          "passRate",
          testRow.testResults, // Pass rate drilldown shows same count as testResults
          dimensions
        );

        expect(passed).toBe(true);
      });

      test("passRate should work with multiple date rows", async ({
        request,
      }) => {
        test.setTimeout(120000);

        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["date"],
          metrics: ["passRate", "testResults"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Test up to 3 dates to ensure consistency
        const datesToTest = reportData.results
          .filter((row: any) => row.testResults && row.testResults > 0)
          .slice(0, 3);

        if (datesToTest.length === 0) {
          test.skip();
          return;
        }

        let passedCount = 0;
        for (const row of datesToTest) {
          const dimensions = extractDimensions(row, ["date"], ["passRate"]);

          const passed = await validateMetricDrillDown(
            request,
            "test-execution",
            projectId,
            row,
            "passRate",
            row.testResults,
            dimensions
          );

          if (passed) {
            passedCount++;
          }
        }

        // All tested dates should pass
        expect(passedCount).toBe(datesToTest.length);
      });

      test("passRate calculation should match testResults count", async ({
        request,
      }) => {
        test.setTimeout(120000);

        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["date"],
          metrics: ["passRate", "testResults"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // For each date, drill down on both passRate and testResults
        // Both should return the same count (excluding untested)
        const testRow = reportData.results.find(
          (row: any) => row.testResults && row.testResults > 0
        );

        if (!testRow) {
          test.skip();
          return;
        }

        const dimensions = extractDimensions(
          testRow,
          ["date"],
          ["passRate", "testResults"]
        );

        // Get drilldown for passRate
        const passRateResponse = await request.post(
          "/api/report-builder/drill-down",
          {
            data: {
              reportType: "test-execution",
              metricId: "passRate",
              projectId,
              dimensions,
            },
          }
        );

        expect(passRateResponse.ok()).toBeTruthy();
        const passRateData = await passRateResponse.json();

        // Get drilldown for testResults
        const testResultsResponse = await request.post(
          "/api/report-builder/drill-down",
          {
            data: {
              reportType: "test-execution",
              metricId: "testResults",
              projectId,
              dimensions,
            },
          }
        );

        expect(testResultsResponse.ok()).toBeTruthy();
        const testResultsData = await testResultsResponse.json();

        // Both drilldowns should return the same total count
        expect(passRateData.total).toBe(testResultsData.total);
        expect(passRateData.total).toBe(testRow.testResults);
      });

      test("testCaseCount should exclude untested status when grouped by date", async ({
        request,
      }) => {
        test.setTimeout(120000);

        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["date"],
          metrics: ["testCaseCount", "testResults"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Test multiple dates to ensure chart and table match
        const datesToTest = reportData.results
          .filter((row: any) => row.testCaseCount && row.testCaseCount > 0)
          .slice(0, 3);

        if (datesToTest.length === 0) {
          test.skip();
          return;
        }

        let passedCount = 0;
        for (const row of datesToTest) {
          const dimensions = extractDimensions(
            row,
            ["date"],
            ["testCaseCount"]
          );

          const passed = await validateMetricDrillDown(
            request,
            "test-execution",
            projectId,
            row,
            "testCaseCount",
            row.testCaseCount,
            dimensions
          );

          if (passed) {
            passedCount++;
          }
        }

        // All tested dates should pass
        expect(passedCount).toBe(datesToTest.length);
      });
    });

    // Test for cross-project test case execution scenario
    //
    // BUG CAUGHT: This test suite catches a critical bug in the testCaseCount drilldown logic.
    //
    // THE PROBLEM:
    // - In the data model, TestRunResults.testRunId can be different from TestRunCases.testRunId
    // - When a test run in Project A (id=370) executes test cases, those test cases might belong
    //   to TestRunCases with a different testRunId that points to a test run in Project B (id=366)
    // - The original implementation filtered TestRunCases by testRun.projectId, which excluded
    //   test cases that were actually executed in Project A but belonged to TestRunCases from Project B
    //
    // THE FIX:
    // - Filter by TestRunResults.testRun.projectId instead of TestRunCases.testRun.projectId
    // - This ensures we get test cases that were actually executed in the project's test runs,
    //   regardless of which project the TestRunCases belong to
    //
    // EXAMPLE FROM REAL DATA (Project 370):
    // - TestRunResults.testRunId = 62601 (belongs to Project 370)
    // - TestRunResults.testRunCaseId = 54486
    // - TestRunCases(id=54486).testRunId = 18256 (belongs to Project 366)
    // - TestRunCases(id=54486).repositoryCaseId = 70367
    // - RepositoryCases(id=70367).projectId = 366
    //
    // The report counts this execution because it happened in Project 370's test run (62601).
    // The drilldown must return this test case too, even though it "belongs" to Project 366.
    //
    test.describe("Cross-Project Test Case Execution", () => {
      test("testCaseCount drilldown should work when test runs execute cases from other projects", async ({
        request,
      }) => {
        test.setTimeout(120000);

        // Project 370 is known to have test runs that execute test cases from project 366
        // This is the exact scenario that triggered the original bug
        const projectId = 370;

        const reportBody = {
          projectId,
          dimensions: ["user"],
          metrics: ["testCaseCount"],
        };

        const reportResponse = await request.post(
          "/api/report-builder/test-execution",
          { data: reportBody }
        );

        expect(reportResponse.ok()).toBeTruthy();
        const reportData = await reportResponse.json();

        if (reportData.results.length === 0) {
          test.skip();
          return;
        }

        // Find rows with non-zero testCaseCount
        const rowsWithCases = reportData.results.filter(
          (row: any) => row.testCaseCount && row.testCaseCount > 0
        );

        if (rowsWithCases.length === 0) {
          test.skip();
          return;
        }

        // Test at least 3 rows to ensure coverage
        const rowsToTest = rowsWithCases.slice(
          0,
          Math.min(3, rowsWithCases.length)
        );
        let passedCount = 0;

        for (const row of rowsToTest) {
          const dimensions = extractDimensions(
            row,
            ["user"],
            ["testCaseCount"]
          );

          const passed = await validateMetricDrillDown(
            request,
            "test-execution",
            projectId,
            row,
            "testCaseCount",
            row.testCaseCount,
            dimensions
          );

          if (passed) {
            passedCount++;
          }
        }

        // All tested rows should pass
        expect(passedCount).toBe(rowsToTest.length);
      });

      test("testCaseCount should match even with mixed project test cases", async ({
        request,
      }) => {
        test.setTimeout(120000);

        // Test with multiple dimension combinations to ensure robustness
        const projectId = 370;
        const dimensionCombos = [["user"], ["status"], ["user", "status"]];

        for (const dimensions of dimensionCombos) {
          const reportBody = {
            projectId,
            dimensions,
            metrics: ["testCaseCount"],
          };

          const reportResponse = await request.post(
            "/api/report-builder/test-execution",
            { data: reportBody }
          );

          expect(reportResponse.ok()).toBeTruthy();
          const reportData = await reportResponse.json();

          if (reportData.results.length === 0) {
            continue;
          }

          // Test first row with non-zero count
          const testRow = reportData.results.find(
            (row: any) => row.testCaseCount && row.testCaseCount > 0
          );

          if (!testRow) {
            continue;
          }

          const rowDimensions = extractDimensions(testRow, dimensions, [
            "testCaseCount",
          ]);

          const passed = await validateMetricDrillDown(
            request,
            "test-execution",
            projectId,
            testRow,
            "testCaseCount",
            testRow.testCaseCount,
            rowDimensions
          );

          expect(passed).toBe(true);
        }
      });
    });

    // Generate summary report after all tests
    test.afterAll(async () => {
      console.log("\n" + "=".repeat(80));
      console.log("DRILL-DOWN COUNT VALIDATION SUMMARY");
      console.log("=".repeat(80) + "\n");

      if (validationErrors.length === 0) {
        console.log(
          "✅ SUCCESS: All drill-down counts matched their report values!\n"
        );
      } else {
        console.log(
          `❌ FAILURES: ${validationErrors.length} mismatches detected\n`
        );

        // Group errors by report type
        const errorsByReport: Record<string, ValidationError[]> = {};
        for (const error of validationErrors) {
          const key = error.reportType;
          if (!errorsByReport[key]) {
            errorsByReport[key] = [];
          }
          errorsByReport[key].push(error);
        }

        // Print summary by report
        console.log("Errors by Report Type:");
        console.log("-".repeat(80));
        for (const [reportType, errors] of Object.entries(errorsByReport)) {
          console.log(`\n${reportType}: ${errors.length} errors`);

          // Group by metric
          const errorsByMetric: Record<string, ValidationError[]> = {};
          for (const error of errors) {
            if (!errorsByMetric[error.metricId]) {
              errorsByMetric[error.metricId] = [];
            }
            errorsByMetric[error.metricId].push(error);
          }

          for (const [metricId, metricErrors] of Object.entries(
            errorsByMetric
          )) {
            const avgDiff =
              metricErrors.reduce(
                (sum, e) => sum + Math.abs(e.percentDifference),
                0
              ) / metricErrors.length;
            console.log(
              `  - ${metricId}: ${metricErrors.length} errors (avg ${avgDiff.toFixed(2)}% difference)`
            );
          }
        }

        // Print detailed error list
        console.log("\n" + "=".repeat(80));
        console.log("DETAILED ERROR LIST");
        console.log("=".repeat(80) + "\n");

        for (let i = 0; i < Math.min(50, validationErrors.length); i++) {
          const error = validationErrors[i];
          console.log(`${i + 1}. ${error.reportType} - ${error.metricId}`);
          console.log(`   Project: ${error.projectId || "cross-project"}`);
          console.log(`   Dimensions: ${JSON.stringify(error.dimensions)}`);
          console.log(
            `   Report: ${error.reportValue}, Drill-down: ${error.drillDownTotal}`
          );
          console.log(
            `   Difference: ${error.difference} (${error.percentDifference.toFixed(2)}%)`
          );
          console.log();
        }

        if (validationErrors.length > 50) {
          console.log(`... and ${validationErrors.length - 50} more errors\n`);
        }

        // Statistics
        console.log("=".repeat(80));
        console.log("STATISTICS");
        console.log("=".repeat(80));
        const totalDiff = validationErrors.reduce(
          (sum, e) => sum + Math.abs(e.difference),
          0
        );
        const avgDiff = totalDiff / validationErrors.length;
        const maxDiff = Math.max(
          ...validationErrors.map((e) => Math.abs(e.difference))
        );
        const avgPercent =
          validationErrors.reduce(
            (sum, e) => sum + Math.abs(e.percentDifference),
            0
          ) / validationErrors.length;

        console.log(`Total Errors: ${validationErrors.length}`);
        console.log(`Average Difference: ${avgDiff.toFixed(2)} records`);
        console.log(`Maximum Difference: ${maxDiff} records`);
        console.log(`Average Percent Difference: ${avgPercent.toFixed(2)}%`);
        console.log();
      }
    });
  }); // Close Legacy Bug Regression Tests describe
}); // Close main describe
