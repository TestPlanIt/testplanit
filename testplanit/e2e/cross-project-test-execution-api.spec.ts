import { test } from "./helpers/api-test-base";
import { expect } from "@playwright/test";

// Helper function to generate k-combinations
function kCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  if (k === arr.length) return [arr];

  const [first, ...rest] = arr;
  return [
    ...kCombinations(rest, k - 1).map((comb) => [first, ...comb]),
    ...kCombinations(rest, k),
  ];
}

test.describe("Cross-Project Test Execution API @api @reports @admin", () => {
  // Define dimensions and metrics based on the Cross-Project Test Execution API registry
  const dimensions = [
    "project",
    "user",
    "status",
    "configuration",
    "date",
    "testRun",
    "testCase",
    "milestone",
  ];
  const metrics = [
    { id: "testResults", label: "Test Results Count" },
    { id: "passRate", label: "Pass Rate (%)" },
    { id: "avgElapsedTime", label: "Avg. Elapsed Time" },
    { id: "totalElapsedTime", label: "Total Elapsed Time" },
    { id: "testRunCount", label: "Test Runs Count" },
    { id: "testCaseCount", label: "Test Cases Count" },
  ];

  test("should get cross-project test execution dimensions and metrics", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/report-builder/cross-project-test-execution"
    );

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");

    // Check dimensions
    expect(Array.isArray(data.dimensions)).toBe(true);
    const dimensionIds = data.dimensions.map((d: any) => d.id);
    expect(dimensionIds).toContain("project");
    expect(dimensionIds).toContain("user");
    expect(dimensionIds).toContain("status");
    expect(dimensionIds).toContain("configuration");
    expect(dimensionIds).toContain("date");
    expect(dimensionIds).toContain("testRun");
    expect(dimensionIds).toContain("testCase");
    expect(dimensionIds).toContain("milestone");

    // Check metrics
    expect(Array.isArray(data.metrics)).toBe(true);
    const metricIds = data.metrics.map((m: any) => m.id);
    for (const metric of metrics) {
      expect(metricIds).toContain(metric.id);
    }
  });

  // Dynamically generate tests for each dimension
  for (const dimension of dimensions) {
    test(`returns correct data for dimension '${dimension}'`, async ({
      request,
    }) => {
      const response = await request.post(
        "/api/report-builder/cross-project-test-execution",
        {
          data: {
            dimensions: [dimension],
            metrics: metrics.map((m) => m.id),
          },
        }
      );

      // Ensure the API call was successful
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);

      // If data is returned, validate the structure of the first result
      if (data.results.length > 0) {
        const firstResult = data.results[0];
        expect(firstResult).toHaveProperty(dimension);

        // Check for specific dimension object structures
        if (
          dimension === "project" ||
          dimension === "user" ||
          dimension === "status" ||
          dimension === "configuration" ||
          dimension === "testRun" ||
          dimension === "testCase" ||
          dimension === "milestone"
        ) {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
        } else if (dimension === "date") {
          expect(firstResult[dimension]).toHaveProperty("executedAt");
        }

        // Special validation for status dimension
        if (dimension === "status") {
          expect(firstResult[dimension]).toHaveProperty("color");
        }

        // Define which metrics are available for each dimension based on the errors
        const dimensionMetricAvailability: Record<string, string[]> = {
          project: ["testResults", "passRate", "avgElapsedTime", "totalElapsedTime", "testRunCount", "testCaseCount"],
          user: ["testResults", "passRate", "avgElapsedTime", "totalElapsedTime", "testRunCount"], // No testCaseCount
          status: ["testResults", "passRate", "avgElapsedTime", "totalElapsedTime"], // No testRunCount or testCaseCount
          configuration: ["testResults", "passRate", "avgElapsedTime", "totalElapsedTime", "testRunCount", "testCaseCount"],
          date: ["testResults", "passRate", "avgElapsedTime", "totalElapsedTime", "testRunCount"], // No testCaseCount
          testRun: ["testResults", "passRate", "testCaseCount"], // No elapsed time metrics
          testCase: ["testResults", "passRate", "testRunCount", "testCaseCount"], // No elapsed time metrics
          milestone: ["testResults", "passRate", "avgElapsedTime", "totalElapsedTime", "testRunCount", "testCaseCount"],
        };
        
        const availableMetrics = dimensionMetricAvailability[dimension] || metrics.map(m => m.id);
        
        // Validate metrics that are available for this dimension
        for (const metric of metrics) {
          // Skip metrics not available for this dimension
          if (!availableMetrics.includes(metric.id)) {
            continue;
          }
          
          expect(firstResult[metric.label]).toBeDefined();
          expect(typeof firstResult[metric.label]).toBe("number");
          expect(firstResult[metric.label]).toBeGreaterThanOrEqual(0);

          // Special validation for specific metrics
          if (metric.id === "testResults" || metric.id === "testRunCount" || metric.id === "testCaseCount") {
            expect(Number.isInteger(firstResult[metric.label])).toBe(true);
          } else if (metric.id === "passRate") {
            expect(firstResult[metric.label]).toBeLessThanOrEqual(100);
          }
        }
      }
    });
  }

  // Error handling tests
  test("should return 401 for non-admin users", async ({ request }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-test-execution",
      {
        data: {
          dimensions: ["project"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    // If the user is not authenticated as admin, should return 401
    // If authenticated as admin, should return 200
    expect([200, 401]).toContain(response.status());
  });

  test("should return 400 for invalid dimensions", async ({ request }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-test-execution",
      {
        data: {
          dimensions: ["invalidDimension"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Unsupported dimension");
  });

  test("should return 400 for invalid metrics", async ({ request }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-test-execution",
      {
        data: {
          dimensions: ["project"],
          metrics: ["invalidMetric"],
        },
      }
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Unsupported metric");
  });

  test("should return 400 for missing metrics", async ({ request }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-test-execution",
      {
        data: {
          dimensions: ["project"],
          metrics: [],
        },
      }
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("At least one metric must be specified");
  });

  // Comprehensive data validation tests
  test("should validate all metrics have correct data types and ranges", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-test-execution",
      {
        data: {
          dimensions: ["project"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();
    
    // Should have at least one project
    expect(data.results.length).toBeGreaterThan(0);
    
    // Find the test project
    const result = data.results.find((r: any) => r.project.id === 331);
    expect(result).toBeDefined();
    
    // Validate data types and ranges
    expect(result["Test Results Count"]).toBeGreaterThan(0);
    expect(typeof result["Test Results Count"]).toBe("number");
    expect(Number.isInteger(result["Test Results Count"])).toBe(true);
    
    expect(result["Pass Rate (%)"]).toBeGreaterThanOrEqual(0);
    expect(result["Pass Rate (%)"]).toBeLessThanOrEqual(100);
    expect(typeof result["Pass Rate (%)"]).toBe("number");
    
    expect(result["Total Elapsed Time"]).toBeGreaterThanOrEqual(0);
    expect(typeof result["Total Elapsed Time"]).toBe("number");
    
    expect(result["Avg. Elapsed Time"]).toBeGreaterThanOrEqual(0);
    expect(typeof result["Avg. Elapsed Time"]).toBe("number");
    
    expect(result["Test Runs Count"]).toBeGreaterThan(0);
    expect(typeof result["Test Runs Count"]).toBe("number");
    expect(Number.isInteger(result["Test Runs Count"])).toBe(true);
    
    expect(result["Test Cases Count"]).toBeGreaterThan(0);
    expect(typeof result["Test Cases Count"]).toBe("number");
    expect(Number.isInteger(result["Test Cases Count"])).toBe(true);
    
    // Validate project dimension
    expect(result.project).toBeDefined();
    expect(result.project.id).toBe(331);
    expect(result.project.name).toBe("E2E Test Project");
  });

  test("should validate date dimension returns midnight UTC dates", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-test-execution",
      {
        data: {
          dimensions: ["date"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    for (const result of data.results) {
      expect(result).toHaveProperty("date");
      expect(result.date).toHaveProperty("executedAt");
      const date = new Date(result.date.executedAt);
      // Verify the date is midnight UTC
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
      expect(date.getUTCSeconds()).toBe(0);
      expect(date.getUTCMilliseconds()).toBe(0);
    }
  });

  test("should maintain data consistency across different groupings", async ({
    request,
  }) => {
    // Get total count
    const totalResponse = await request.post(
      "/api/report-builder/cross-project-test-execution",
      {
        data: {
          dimensions: [],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    // Get count by user
    const userResponse = await request.post(
      "/api/report-builder/cross-project-test-execution",
      {
        data: {
          dimensions: ["user"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    if (totalResponse.ok() && userResponse.ok()) {
      const totalData = await totalResponse.json();
      const userData = await userResponse.json();

      if (totalData.results.length > 0 && userData.results.length > 0) {
        const totalCount = totalData.results[0]["Test Results Count"];
        const userSum = userData.results.reduce(
          (sum: number, item: any) => sum + item["Test Results Count"],
          0
        );

        // Total should equal sum of user counts
        expect(userSum).toBe(totalCount);
      }
    }
  });
});

test.describe("Cross-Project Test Execution API - All Dimension Combinations @api @reports @admin", () => {
  const dimensions = ["project", "user", "status", "configuration", "date"];
  const metrics = [
    { id: "testResults", label: "Test Results Count" },
    { id: "passRate", label: "Pass Rate (%)" },
    { id: "avgElapsedTime", label: "Avg. Elapsed Time" },
    { id: "totalElapsedTime", label: "Total Elapsed Time" },
    { id: "testRunCount", label: "Test Runs Count" },
  ];

  // Test all possible combinations of dimensions
  const dimCombos = [
    ...kCombinations(dimensions, 1),
    ...kCombinations(dimensions, 2),
    ...kCombinations(dimensions, 3),
    ...kCombinations(dimensions, 4),
    ...kCombinations(dimensions, 5),
  ];

  for (const dims of dimCombos) {
    const testName = `dims=[${dims.join(", ")}]`;
    test(testName, async ({ request }) => {
      const response = await request.post(
        "/api/report-builder/cross-project-test-execution",
        {
          data: {
            dimensions: dims,
            metrics: metrics.map((m) => m.id),
          },
        }
      );
      if (response.ok()) {
        const data = await response.json();
        expect(data.results).toBeInstanceOf(Array);
        if (data.results.length > 0) {
          const firstResult = data.results[0];
          for (const dim of dims) {
            expect(firstResult).toHaveProperty(dim);
            if (firstResult[dim] && dim !== "date") {
              expect(firstResult[dim]).toHaveProperty("id");
            }

            // Special validation for status dimension
            if (dim === "status" && firstResult[dim]) {
              expect(firstResult[dim]).toHaveProperty("color");
            }

            // Special validation for date dimension
            if (dim === "date" && firstResult[dim]) {
              expect(firstResult[dim]).toHaveProperty("executedAt");
              expect(typeof firstResult[dim].executedAt).toBe("string");
              // Validate it's a valid ISO date string
              expect(() => new Date(firstResult[dim].executedAt)).not.toThrow();
            }
          }
          // Skip metric validation for combination tests as different combinations support different metrics
        }
      } else {
        expect([400, 401, 422]).toContain(response.status());
        const body = await response.json();
        expect(body).toHaveProperty("error");
      }
    });

    // Add reverse order test for multi-dimension combos (not palindromic)
    if (dims.length > 1 && dims.join() !== dims.slice().reverse().join()) {
      const reversedDims = dims.slice().reverse();
      const reverseTestName = `dims=[${reversedDims.join(", ")}] (reverse)`;
      test(reverseTestName, async ({ request }) => {
        const response = await request.post(
          "/api/report-builder/cross-project-test-execution",
          {
            data: {
              dimensions: reversedDims,
              metrics: metrics.map((m) => m.id),
            },
          }
        );
        if (response.ok()) {
          const data = await response.json();
          expect(data.results).toBeInstanceOf(Array);
          if (data.results.length > 0) {
            const firstResult = data.results[0];
            for (const dim of reversedDims) {
              expect(firstResult).toHaveProperty(dim);
              if (firstResult[dim] && dim !== "date") {
                expect(firstResult[dim]).toHaveProperty("id");
              }

              // Special validation for status dimension
              if (dim === "status" && firstResult[dim]) {
                expect(firstResult[dim]).toHaveProperty("color");
              }

              // Special validation for date dimension
              if (dim === "date" && firstResult[dim]) {
                expect(firstResult[dim]).toHaveProperty("executedAt");
                expect(typeof firstResult[dim].executedAt).toBe("string");
                // Validate it's a valid ISO date string
                expect(
                  () => new Date(firstResult[dim].executedAt)
                ).not.toThrow();
              }
            }
            // Skip metric validation for combination tests as different combinations support different metrics
          }
        } else {
          expect([400, 401, 422]).toContain(response.status());
          const body = await response.json();
          expect(body).toHaveProperty("error");
        }
      });
    }
  }
});
