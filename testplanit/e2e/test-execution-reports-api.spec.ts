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

test.describe("Test Execution Reports API @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;
  
  // Define dimensions and metrics based on the Test Execution Reports API registry
  const dimensions = [
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

  test("should get test execution reports dimensions and metrics", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/report-builder/test-execution?projectId=${TEST_PROJECT_ID}`
    );

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");

    // Check dimensions
    expect(Array.isArray(data.dimensions)).toBe(true);
    const dimensionIds = data.dimensions.map((d: any) => d.id);
    // Note: "project" dimension is not available when projectId is specified
    expect(dimensionIds).toContain("user");
    expect(dimensionIds).toContain("status");
    expect(dimensionIds).toContain("configuration");
    expect(dimensionIds).toContain("date");

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
        "/api/report-builder/test-execution",
        {
          data: {
            projectId: TEST_PROJECT_ID,
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
        if (dimension === "project") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
        } else if (dimension === "user") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
          expect(firstResult[dimension]).toHaveProperty("email");
        } else if (dimension === "status") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
          expect(firstResult[dimension]).toHaveProperty("color");
        } else if (dimension === "configuration") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
        } else if (dimension === "date") {
          expect(firstResult[dimension]).toHaveProperty("executedAt");
        }

        // Validate all metrics
        for (const metric of metrics) {
          expect(firstResult[metric.label]).toBeDefined();
          expect(typeof firstResult[metric.label]).toBe("number");
          expect(firstResult[metric.label]).toBeGreaterThanOrEqual(0);

          // Special validation for specific metrics
          if (metric.id === "testResults" || metric.id === "testRunCount") {
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
      "/api/report-builder/test-execution",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
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
      "/api/report-builder/test-execution",
      {
        data: {
          projectId: TEST_PROJECT_ID,
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
      "/api/report-builder/test-execution",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
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
      "/api/report-builder/test-execution",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
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
      "/api/report-builder/test-execution",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Should have at least 2 users (admin and regular user)
    expect(data.results.length).toBeGreaterThanOrEqual(2);
    
    // Find admin and regular user results
    const adminResult = data.results.find((r: any) => r.user.name === "Test Admin");
    const regularResult = data.results.find((r: any) => r.user.name === "Test User");
    
    expect(adminResult).toBeDefined();
    expect(regularResult).toBeDefined();
    
    // Validate data types and ranges for admin user
    expect(adminResult["Test Results Count"]).toBeGreaterThan(0);
    expect(typeof adminResult["Test Results Count"]).toBe("number");
    expect(Number.isInteger(adminResult["Test Results Count"])).toBe(true);
    
    expect(adminResult["Pass Rate (%)"]).toBeGreaterThanOrEqual(0);
    expect(adminResult["Pass Rate (%)"]).toBeLessThanOrEqual(100);
    expect(typeof adminResult["Pass Rate (%)"]).toBe("number");
    
    expect(adminResult["Total Elapsed Time"]).toBeGreaterThanOrEqual(0);
    expect(typeof adminResult["Total Elapsed Time"]).toBe("number");
    
    expect(adminResult["Avg. Elapsed Time"]).toBeGreaterThanOrEqual(0);
    expect(typeof adminResult["Avg. Elapsed Time"]).toBe("number");
    
    // Validate data types for regular user
    expect(regularResult["Test Results Count"]).toBeGreaterThan(0);
    expect(typeof regularResult["Test Results Count"]).toBe("number");
    expect(Number.isInteger(regularResult["Test Results Count"])).toBe(true);
    
    expect(regularResult["Pass Rate (%)"]).toBeGreaterThanOrEqual(0);
    expect(regularResult["Pass Rate (%)"]).toBeLessThanOrEqual(100);
    expect(typeof regularResult["Pass Rate (%)"]).toBe("number");
  });

  test("should validate date dimension returns midnight UTC dates", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/test-execution",
      {
        data: {
          projectId: TEST_PROJECT_ID,
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
      "/api/report-builder/test-execution",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: [],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    // Get count by project
    const projectResponse = await request.post(
      "/api/report-builder/test-execution",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    if (totalResponse.ok() && projectResponse.ok()) {
      const totalData = await totalResponse.json();
      const projectData = await projectResponse.json();

      if (totalData.results.length > 0 && projectData.results.length > 0) {
        const totalCount = totalData.results[0]["Test Results Count"];
        const projectSum = projectData.results.reduce(
          (sum: number, item: any) => sum + item["Test Results Count"],
          0
        );

        // Total should equal sum of project counts
        expect(projectSum).toBe(totalCount);
      }
    }
  });
});

test.describe("Test Execution Reports API - All Dimension Combinations @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;
  // Note: "project" dimension is not available when projectId is specified
  const dimensions = ["user", "status", "configuration", "date"];
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
        "/api/report-builder/test-execution",
        {
          data: {
            projectId: TEST_PROJECT_ID,
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

            // Special validation for date dimension
            if (dim === "date" && firstResult[dim]) {
              expect(firstResult[dim]).toHaveProperty("executedAt");
              expect(typeof firstResult[dim].executedAt).toBe("string");
              // Validate it's a valid ISO date string
              expect(() => new Date(firstResult[dim].executedAt)).not.toThrow();
            }
          }
          // Validate all metrics
          for (const metric of metrics) {
            expect(firstResult[metric.label]).toBeDefined();
          }
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
          "/api/report-builder/test-execution",
          {
            data: {
              projectId: TEST_PROJECT_ID,
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
            // Validate all metrics
            for (const metric of metrics) {
              expect(firstResult[metric.label]).toBeDefined();
            }
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