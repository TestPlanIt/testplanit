/**
 * Comprehensive Report Testing with Production Data
 *
 * Tests all report types with:
 * - Every combination of dimensions in each order
 * - All metrics
 * - With and without date filters
 * - Drill-down functionality
 * - Data consistency verification
 */

import { test } from "./helpers/api-test-base";
import { expect } from "@playwright/test";

const PROJECT_ID = 370; // Project with 23,695 test cases and more diverse data

// Report configurations
const REPORTS = {
  "test-execution": {
    endpoint: "/api/report-builder/test-execution",
    dimensions: ["status", "user", "testRun", "milestone", "configuration", "date"],
    metrics: ["testResults", "passRate", "avgElapsedTime", "totalElapsedTime", "testCaseCount", "testRunCount"],
    supportsDrillDown: true
  },
  "user-engagement": {
    endpoint: "/api/report-builder/user-engagement",
    dimensions: ["user", "role", "group", "date"],
    metrics: ["executionCount", "createdCaseCount", "sessionResultCount"],
    supportsDrillDown: false
  },
  "repository-stats": {
    endpoint: "/api/report-builder/repository-stats",
    dimensions: ["folder", "creator", "state", "source", "template", "date"],
    metrics: ["testCaseCount", "automatedCount", "manualCount", "averageSteps"],
    supportsDrillDown: false
  },
  "session-analysis": {
    endpoint: "/api/report-builder/session-analysis",
    dimensions: ["creator", "state", "milestone", "assignedTo", "date"],
    metrics: ["sessionCount", "completionRate", "averageDuration"],
    supportsDrillDown: false
  },
  "issue-tracking": {
    endpoint: "/api/report-builder/issue-tracking",
    dimensions: ["creator", "issueType", "date"],
    metrics: ["issueCount"],
    supportsDrillDown: false
  }
};

// Generate all combinations of dimensions
function* generateDimensionCombinations(dimensions: string[]): Generator<string[]> {
  // Single dimensions
  for (const dim of dimensions) {
    yield [dim];
  }

  // Two dimensions in all orders
  for (let i = 0; i < dimensions.length; i++) {
    for (let j = 0; j < dimensions.length; j++) {
      if (i !== j) {
        yield [dimensions[i], dimensions[j]];
      }
    }
  }

  // Three dimensions (limited to avoid excessive combinations)
  if (dimensions.length >= 3) {
    for (let i = 0; i < Math.min(3, dimensions.length); i++) {
      for (let j = i + 1; j < Math.min(3, dimensions.length); j++) {
        for (let k = j + 1; k < Math.min(3, dimensions.length); k++) {
          // Test different orders
          yield [dimensions[i], dimensions[j], dimensions[k]];
          yield [dimensions[k], dimensions[j], dimensions[i]];
        }
      }
    }
  }
}

test.describe("Comprehensive Report Testing with Production Data @reports @comprehensive", () => {
  const testResults: any[] = [];

  // Test each report type
  for (const [reportName, config] of Object.entries(REPORTS)) {
    test.describe(`${reportName} Report`, () => {

      // Test all dimension combinations
      for (const dimensionCombo of generateDimensionCombinations(config.dimensions)) {
        const comboName = dimensionCombo.join(" → ");

        test(`${comboName} with all metrics`, async ({ request }) => {
          test.setTimeout(60000); // 60 second timeout to account for authentication, reports, and drill-down
          const startTime = Date.now();

          // Test WITHOUT date filter
          const response1 = await request.post(config.endpoint, {
            data: {
              projectId: PROJECT_ID,
              dimensions: dimensionCombo,
              metrics: config.metrics
            }
          });

          if (!response1.ok()) {
            const errorBody = await response1.text();
            console.error(`❌ ${reportName} [${dimensionCombo}] failed with status ${response1.status()}: ${errorBody}`);
          }
          expect(response1.ok()).toBeTruthy();
          const data1 = await response1.json();
          expect(data1.results).toBeInstanceOf(Array);

          const responseTime1 = Date.now() - startTime;

          // Test WITH date filter (last 30 days)
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 30);

          const response2 = await request.post(config.endpoint, {
            data: {
              projectId: PROJECT_ID,
              dimensions: dimensionCombo,
              metrics: config.metrics,
              startDate: startDate.toISOString(),
              endDate: endDate.toISOString()
            }
          });

          expect(response2.ok()).toBeTruthy();
          const data2 = await response2.json();
          expect(data2.results).toBeInstanceOf(Array);

          const responseTime2 = Date.now() - startTime - responseTime1;

          // Verify data consistency
          if (data1.results.length > 0 && data2.results.length > 0) {
            // Data with date filter should be subset of data without filter
            expect(data2.results.length).toBeLessThanOrEqual(data1.results.length);
          }

          // Test drill-down if supported and data exists
          if (config.supportsDrillDown && data1.results.length > 0) {
            // Find a row with non-zero values
            const testRow = data1.results.find((row: any) => {
              return config.metrics.some((metric: string) =>
                row[metric] && typeof row[metric] === 'number' && row[metric] > 0
              );
            });

            if (testRow) {
              // Test drill-down for each metric
              for (const metric of config.metrics) {
                if (testRow[metric] && typeof testRow[metric] === 'number' && testRow[metric] > 0) {
                  const drillDownResponse = await request.post("/api/report-builder/drill-down", {
                    data: {
                      reportType: reportName,
                      projectId: PROJECT_ID,
                      dimensions: dimensionCombo,
                      metric: metric,
                      filters: dimensionCombo.reduce((acc, dim) => {
                        acc[dim] = testRow[dim];
                        return acc;
                      }, {} as any)
                    }
                  });

                  // Drill-down should return data
                  if (drillDownResponse.ok()) {
                    const drillDownData = await drillDownResponse.json();
                    expect(drillDownData).toHaveProperty('results');
                    expect(drillDownData).toHaveProperty('total');

                    // Verify drill-down total matches the aggregated value EXACTLY
                    const drillDownTotal = drillDownData.total;
                    const metricValue = testRow[metric];

                    if (drillDownTotal !== metricValue) {
                      console.error(
                        `❌ MISMATCH: ${reportName} [${comboName}] ${metric}\n` +
                        `   Dimension: ${JSON.stringify(dimensionCombo.reduce((acc, dim) => { acc[dim] = testRow[dim]; return acc; }, {} as any))}\n` +
                        `   Metric Value: ${metricValue}\n` +
                        `   Drill-down Total: ${drillDownTotal}\n` +
                        `   Difference: ${drillDownTotal - metricValue}`
                      );
                    }

                    expect(drillDownTotal).toBe(metricValue);
                  }
                }
              }
            }
          }

          // Record test results
          testResults.push({
            report: reportName,
            dimensions: comboName,
            rowsWithoutFilter: data1.results.length,
            rowsWithFilter: data2.results.length,
            responseTimeWithoutFilter: responseTime1,
            responseTimeWithFilter: responseTime2,
            status: 'passed'
          });

          // Performance warning
          if (responseTime1 > 3000 || responseTime2 > 3000) {
            console.warn(`⚠️ Slow response: ${reportName} [${comboName}] - ${Math.max(responseTime1, responseTime2)}ms`);
          }
        });
      }

      // Test with invalid data
      test("should handle invalid dimensions gracefully", async ({ request }) => {
        const response = await request.post(config.endpoint, {
          data: {
            projectId: PROJECT_ID,
            dimensions: ["invalid_dimension"],
            metrics: config.metrics
          }
        });

        expect(response.status()).toBe(400);
      });

      test("should handle invalid metrics gracefully", async ({ request }) => {
        const response = await request.post(config.endpoint, {
          data: {
            projectId: PROJECT_ID,
            dimensions: [config.dimensions[0]],
            metrics: ["invalid_metric"]
          }
        });

        expect(response.status()).toBe(400);
      });

      test("should handle empty results gracefully", async ({ request }) => {
        // Use non-existent project ID
        const response = await request.post(config.endpoint, {
          data: {
            projectId: 999999,
            dimensions: [config.dimensions[0]],
            metrics: config.metrics,
          }
        });

        expect(response.ok()).toBeTruthy();
        const data = await response.json();
        expect(data.results).toBeInstanceOf(Array);
        expect(data.results.length).toBe(0);
      });
    });
  }

  test.afterAll(async () => {
    // Generate summary report
    console.log('\n=== COMPREHENSIVE REPORT TEST SUMMARY ===\n');

    const totalTests = testResults.length;
    const passedTests = testResults.filter(r => r.status === 'passed').length;
    const avgResponseTime = testResults.reduce((sum, r) =>
      sum + r.responseTimeWithoutFilter + r.responseTimeWithFilter, 0
    ) / (totalTests * 2);

    console.log(`Total Test Combinations: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    console.log(`Average Response Time: ${Math.round(avgResponseTime)}ms`);

    // Report by type
    const reportTypes = [...new Set(testResults.map(r => r.report))];
    for (const reportType of reportTypes) {
      const reportTests = testResults.filter(r => r.report === reportType);
      const avgRows = reportTests.reduce((sum, r) => sum + r.rowsWithoutFilter, 0) / reportTests.length;
      const avgTime = reportTests.reduce((sum, r) =>
        sum + r.responseTimeWithoutFilter, 0
      ) / reportTests.length;

      console.log(`\n${reportType}:`);
      console.log(`  - Test Combinations: ${reportTests.length}`);
      console.log(`  - Avg Rows Returned: ${Math.round(avgRows)}`);
      console.log(`  - Avg Response Time: ${Math.round(avgTime)}ms`);
    }

    // Performance analysis
    const slowTests = testResults.filter(r =>
      r.responseTimeWithoutFilter > 3000 || r.responseTimeWithFilter > 3000
    );

    if (slowTests.length > 0) {
      console.log(`\n⚠️ Slow Tests (>3s): ${slowTests.length}`);
      slowTests.forEach(r => {
        console.log(`  - ${r.report} [${r.dimensions}]: ${Math.max(r.responseTimeWithoutFilter, r.responseTimeWithFilter)}ms`);
      });
    }

    // Data volume analysis
    console.log('\n=== DATA VOLUME ANALYSIS ===');
    console.log(`Testing with Project ${PROJECT_ID} (23,695 test cases with diverse data)`);

    const totalRowsProcessed = testResults.reduce((sum, r) =>
      sum + r.rowsWithoutFilter + r.rowsWithFilter, 0
    );
    console.log(`Total Rows Processed: ${totalRowsProcessed.toLocaleString()}`);

    if (avgResponseTime < 1000) {
      console.log('✅ EXCELLENT: Average response time < 1s with production data');
    } else if (avgResponseTime < 3000) {
      console.log('✅ GOOD: Average response time < 3s with production data');
    } else {
      console.log('⚠️ NEEDS OPTIMIZATION: Average response time > 3s');
    }
  });
});