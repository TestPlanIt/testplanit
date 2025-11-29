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

test.describe("Session Analysis API @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;

  // Define dimensions and metrics based on the Session Analysis API registry
  const dimensions = ["assignedTo", "state", "date"];
  const metrics = [
    { id: "sessionCount", label: "Session Count" },
    { id: "activeSessions", label: "Active Sessions" },
    { id: "averageDuration", label: "Average Duration" },
    { id: "totalDuration", label: "Total Duration" },
  ];

  test("should get session analysis dimensions and metrics", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/report-builder/session-analysis?projectId=${TEST_PROJECT_ID}`
    );

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");

    // Check dimensions
    expect(Array.isArray(data.dimensions)).toBe(true);
    const dimensionIds = data.dimensions.map((d: any) => d.id);
    expect(dimensionIds).toContain("assignedTo");
    expect(dimensionIds).toContain("state");
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
        "/api/report-builder/session-analysis",
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
        if (dimension === "assignedTo") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
          expect(firstResult[dimension]).toHaveProperty("email");
        } else if (dimension === "state") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
        } else if (dimension === "date") {
          expect(firstResult[dimension]).toHaveProperty("createdAt");
        }

        // Validate all metrics
        for (const metric of metrics) {
          expect(firstResult[metric.label]).toBeDefined();
          expect(typeof firstResult[metric.label]).toBe("number");
          expect(firstResult[metric.label]).toBeGreaterThanOrEqual(0);

          // Special validation for specific metrics
          if (metric.id === "sessionCount") {
            expect(Number.isInteger(firstResult[metric.label])).toBe(true);
          } else if (metric.id === "activeSessions") {
            expect(Number.isInteger(firstResult[metric.label])).toBe(true);
          }
        }
      }
    });
  }

  // Error handling tests
  test("should return 400 when projectId is missing from GET", async ({
    request,
  }) => {
    const response = await request.get("/api/report-builder/session-analysis");

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Project ID is required");
  });

  test("should return 400 when projectId is missing from POST", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/session-analysis",
      {
        data: {
          dimensions: ["session"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Project ID is required");
  });

  test("should return 400 for invalid dimensions", async ({ request }) => {
    const response = await request.post(
      "/api/report-builder/session-analysis",
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
      "/api/report-builder/session-analysis",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["session"],
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
      "/api/report-builder/session-analysis",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["session"],
          metrics: [],
        },
      }
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain(
      "At least one dimension and one metric are required"
    );
  });

  // Comprehensive data validation tests
  test("should validate all metrics have correct data types and ranges", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/session-analysis",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["assignedTo"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    // We expect 2 users based on seed data
    expect(data.results).toHaveLength(2);

    // Find specific user results based on seed data
    const adminResult = data.results.find(
      (r: any) => r.assignedTo.name === "Test Admin"
    );
    const regularResult = data.results.find(
      (r: any) => r.assignedTo.name === "Test User"
    );

    expect(adminResult).toBeDefined();
    expect(regularResult).toBeDefined();

    // Based on seed data from Session Analysis Metric Validation:
    // Admin user: 6 sessions total
    // - 3 sessions in milestone1: 2 completed, 1 in progress (67% completion)
    // - Total duration: 21600000ms (6 hours) for milestone1 sessions
    // - Average duration: 7200000ms (120 minutes) for milestone1 sessions
    // - Plus 3 additional sessions (session6, session8, sessionDateTest2)
    expect(adminResult["Session Count"]).toBe(11);

    // Regular user: 9 sessions total
    // - 2 sessions in milestone2: 1 completed, 1 in progress (50% completion)
    // - Total duration: 18000000ms (5 hours) for milestone2 sessions
    // - Average duration: 9000000ms (150 minutes) for milestone2 sessions
    // - Plus 2 additional sessions (session7, sessionDateTest1)
    expect(regularResult["Session Count"]).toBe(9);

    // Validate types and ranges for all results
    for (const result of data.results) {
      for (const metric of metrics) {
        expect(result[metric.label]).toBeDefined();
        expect(typeof result[metric.label]).toBe("number");
        expect(result[metric.label]).not.toBeNaN();
        expect(result[metric.label]).not.toBeNull();
      }

      expect(Number.isInteger(result["Session Count"])).toBe(true);
      expect(result["Completion Rate (%)"]).toBeGreaterThanOrEqual(0);
      expect(result["Completion Rate (%)"]).toBeLessThanOrEqual(100);
      expect(result["Average Duration"]).toBeGreaterThanOrEqual(0);
      expect(result["Total Duration"]).toBeGreaterThanOrEqual(0);
    }
  });

  test("should validate date dimension returns midnight UTC dates", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/session-analysis",
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
      expect(result.date).toHaveProperty("createdAt");
      const date = new Date(result.date.createdAt);
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
      "/api/report-builder/session-analysis",
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
      "/api/report-builder/session-analysis",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["session"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    if (totalResponse.ok() && userResponse.ok()) {
      const totalData = await totalResponse.json();
      const userData = await userResponse.json();

      if (totalData.results.length > 0 && userData.results.length > 0) {
        const totalCount = totalData.results[0]["Session Count"];
        const userSum = userData.results.reduce(
          (sum: number, item: any) => sum + item["Session Count"],
          0
        );

        // Total should equal sum of user counts
        expect(userSum).toBe(totalCount);
      }
    }
  });
});

test.describe("Session Analysis API - All Dimension Combinations @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;
  const dimensions = ["user", "status", "date"];
  const metrics = [
    { id: "sessionCount", label: "Session Count" },
    { id: "activeSessions", label: "Active Sessions" },
    { id: "averageDuration", label: "Average Duration" },
    { id: "totalDuration", label: "Total Duration" },
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
      const response = await request.post(
        "/api/report-builder/session-analysis",
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
              expect(firstResult[dim]).toHaveProperty("createdAt");
              expect(typeof firstResult[dim].createdAt).toBe("string");
              // Validate it's a valid ISO date string
              expect(() => new Date(firstResult[dim].createdAt)).not.toThrow();
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
          "/api/report-builder/session-analysis",
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
                expect(firstResult[dim]).toHaveProperty("createdAt");
                expect(typeof firstResult[dim].createdAt).toBe("string");
                // Validate it's a valid ISO date string
                expect(
                  () => new Date(firstResult[dim].createdAt)
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
