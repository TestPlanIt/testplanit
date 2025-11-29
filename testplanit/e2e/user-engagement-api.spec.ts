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

test.describe("User Engagement API @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;
  
  // Define dimensions and metrics based on the User Engagement API registry
  const dimensions = ["user", "role", "date"];
  const metrics = [
    { id: "executionCount", label: "Test Executions" },
    { id: "createdCaseCount", label: "Created Test Case Count" },
    { id: "sessionResultCount", label: "Session Result Count" },
    { id: "averageElapsed", label: "Average Time per Execution (seconds)" },
    { id: "lastActiveDate", label: "Last Active Date" },
  ];

  test("should get user engagement dimensions and metrics", async ({
    request,
  }) => {
    const response = await request.get(`/api/report-builder/user-engagement?projectId=${TEST_PROJECT_ID}`);

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");

    // Check dimensions
    expect(Array.isArray(data.dimensions)).toBe(true);
    const dimensionIds = data.dimensions.map((d: any) => d.id);
    expect(dimensionIds).toContain("user");
    expect(dimensionIds).toContain("role");
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
      // Filter out lastActiveDate metric when not using user dimension
      const filteredMetrics = dimension !== "user" 
        ? metrics.filter(m => m.id !== "lastActiveDate")
        : metrics;
        
      const response = await request.post(
        "/api/report-builder/user-engagement",
        {
          data: {
            projectId: TEST_PROJECT_ID,
            dimensions: [dimension],
            metrics: filteredMetrics.map((m) => m.id),
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
        if (dimension === "user") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
          expect(firstResult[dimension]).toHaveProperty("email");
        } else if (dimension === "role") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
        } else if (dimension === "date") {
          expect(firstResult[dimension]).toHaveProperty("executedAt");
        }

        // Validate all metrics
        for (const metric of filteredMetrics) {
          expect(firstResult[metric.label]).toBeDefined();
          
          // lastActiveDate can be either a string (ISO date) or number (timestamp)
          if (metric.id === "lastActiveDate") {
            expect(firstResult[metric.label]).toBeDefined();
            // Skip numeric validations for date values
          } else {
            expect(typeof firstResult[metric.label]).toBe("number");
            expect(firstResult[metric.label]).toBeGreaterThanOrEqual(0);

            // Special validation for specific metrics
            if (metric.id === "testRunCount" || metric.id === "testResults") {
              expect(Number.isInteger(firstResult[metric.label])).toBe(true);
            } else if (metric.id === "passRate") {
              expect(firstResult[metric.label]).toBeLessThanOrEqual(100);
            }
          }
        }
      }
    });
  }

  // Error handling tests
  test("should return 400 when projectId is missing", async ({ request }) => {
    const response = await request.post("/api/report-builder/user-engagement", {
      data: {
        dimensions: ["user"],
        metrics: metrics.map((m) => m.id),
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Project ID is required");
  });

  test("should return 400 for invalid dimensions", async ({ request }) => {
    const response = await request.post("/api/report-builder/user-engagement", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["invalidDimension"],
        metrics: metrics.filter(m => m.id !== "lastActiveDate").map((m) => m.id),
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Unsupported dimension");
  });

  test("should return 400 for invalid metrics", async ({ request }) => {
    const response = await request.post("/api/report-builder/user-engagement", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["user"],
        metrics: ["invalidMetric"],
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Unsupported metric");
  });

  test("should return 400 for missing metrics", async ({ request }) => {
    const response = await request.post("/api/report-builder/user-engagement", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["user"],
        metrics: [],
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("At least one metric must be specified");
  });

  // Comprehensive data validation tests
  test("should validate all metrics have correct data types and ranges", async ({
    request,
  }) => {
    const response = await request.post("/api/report-builder/user-engagement", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["user"],
        metrics: metrics.map((m) => m.id),
      },
    });

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
    expect(adminResult["Test Executions"]).toBeGreaterThan(0);
    expect(typeof adminResult["Test Executions"]).toBe("number");
    expect(Number.isInteger(adminResult["Test Executions"])).toBe(true);
    
    expect(adminResult["Average Time per Execution (seconds)"]).toBeGreaterThanOrEqual(0);
    expect(typeof adminResult["Average Time per Execution (seconds)"]).toBe("number");
    
    // Validate data types for regular user
    expect(regularResult["Test Executions"]).toBeGreaterThan(0);
    expect(typeof regularResult["Test Executions"]).toBe("number");
    expect(Number.isInteger(regularResult["Test Executions"])).toBe(true);
    
    expect(regularResult["Average Time per Execution (seconds)"]).toBeGreaterThanOrEqual(0);
    expect(typeof regularResult["Average Time per Execution (seconds)"]).toBe("number");
  });

  test("should validate date dimension returns midnight UTC dates", async ({
    request,
  }) => {
    // Filter out lastActiveDate metric when using date dimension
    const filteredMetrics = metrics.filter(m => m.id !== "lastActiveDate");
    
    const response = await request.post("/api/report-builder/user-engagement", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["date"],
        metrics: filteredMetrics.map((m) => m.id),
      },
    });

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
      "/api/report-builder/user-engagement",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: [],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    // Get count by user
    const userResponse = await request.post(
      "/api/report-builder/user-engagement",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    if (totalResponse.ok() && userResponse.ok()) {
      const totalData = await totalResponse.json();
      const userData = await userResponse.json();

      if (totalData.results.length > 0 && userData.results.length > 0) {
        const totalCount = totalData.results[0]["Test Executions"];
        const userSum = userData.results.reduce(
          (sum: number, item: any) => sum + item["Test Executions"],
          0
        );

        // Total should equal sum of user counts
        expect(userSum).toBe(totalCount);
      }
    }
  });
});

test.describe("User Engagement API - All Dimension Combinations @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;
  const dimensions = ["user", "role", "date"];
  const metrics = [
    { id: "executionCount", label: "Test Executions" },
    { id: "createdCaseCount", label: "Created Test Case Count" },
    { id: "sessionResultCount", label: "Session Result Count" },
    { id: "averageElapsed", label: "Average Time per Execution (seconds)" },
    { id: "lastActiveDate", label: "Last Active Date" },
  ];

  // Test all possible combinations of dimensions
  const dimCombos = [
    ...kCombinations(dimensions, 1),
    ...kCombinations(dimensions, 2),
    ...kCombinations(dimensions, 3),
  ];

  for (const dims of dimCombos) {
    const testName = `dims=[${dims.join(", ")}]`;
    test(testName, async ({ request }) => {
      // Filter out lastActiveDate metric when not using user dimension
      const filteredMetrics = !dims.includes("user") 
        ? metrics.filter(m => m.id !== "lastActiveDate")
        : metrics;
        
      const response = await request.post(
        "/api/report-builder/user-engagement",
        {
          data: {
            projectId: TEST_PROJECT_ID,
            dimensions: dims,
            metrics: filteredMetrics.map((m) => m.id),
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
          const metricsToValidate = !dims.includes("user") 
            ? metrics.filter(m => m.id !== "lastActiveDate")
            : metrics;
          for (const metric of metricsToValidate) {
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
        // Filter out lastActiveDate metric when not using user dimension
        const filteredMetrics = !reversedDims.includes("user") 
          ? metrics.filter(m => m.id !== "lastActiveDate")
          : metrics;
          
        const response = await request.post(
          "/api/report-builder/user-engagement",
          {
            data: {
              projectId: TEST_PROJECT_ID,
              dimensions: reversedDims,
              metrics: filteredMetrics.map((m) => m.id),
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
            const metricsToValidate = !reversedDims.includes("user") 
              ? metrics.filter(m => m.id !== "lastActiveDate")
              : metrics;
            for (const metric of metricsToValidate) {
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
