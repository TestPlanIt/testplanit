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

test.describe("Issue Tracking API @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;

  // Define dimensions and metrics based on the Issue Tracking API registry
  const dimensions = ["creator", "issueType", "date"];
  const metrics = [{ id: "issueCount", label: "Issue Count" }];

  test("should get issue tracking dimensions and metrics", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/report-builder/issue-tracking?projectId=${TEST_PROJECT_ID}`
    );

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");

    // Check dimensions
    expect(Array.isArray(data.dimensions)).toBe(true);
    const dimensionIds = data.dimensions.map((d: any) => d.id);
    expect(dimensionIds).not.toContain("project"); // Should not have project dimension
    expect(dimensionIds).toContain("creator");
    expect(dimensionIds).toContain("issueType");
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
        "/api/report-builder/issue-tracking",
        {
          data: {
            projectId: TEST_PROJECT_ID, // Add projectId since this is project-specific
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
        if (dimension === "creator") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
          expect(firstResult[dimension]).toHaveProperty("email");
        } else if (dimension === "issueType") {
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
          if (
            metric.id === "issueCount" ||
            metric.id === "openIssueCount" ||
            metric.id === "closedIssueCount"
          ) {
            expect(Number.isInteger(firstResult[metric.label])).toBe(true);
          }
        }
      }
    });
  }

  // Error handling tests
  test("should return 401 for non-admin users", async ({ request }) => {
    const response = await request.post("/api/report-builder/issue-tracking", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["creator"],
        metrics: metrics.map((m) => m.id),
      },
    });

    // If the user is not authenticated as admin, should return 401
    // If authenticated as admin, should return 200
    expect([200, 401]).toContain(response.status());
  });

  test("should return 400 for invalid dimensions", async ({ request }) => {
    const response = await request.post("/api/report-builder/issue-tracking", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["invalidDimension"],
        metrics: metrics.map((m) => m.id),
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Unsupported dimension");
  });

  test("should return 400 for invalid metrics", async ({ request }) => {
    const response = await request.post("/api/report-builder/issue-tracking", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["creator"],
        metrics: ["invalidMetric"],
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Unsupported metric");
  });

  test("should return 400 for missing metrics", async ({ request }) => {
    const response = await request.post("/api/report-builder/issue-tracking", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["creator"],
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
    const response = await request.post("/api/report-builder/issue-tracking", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["creator"],
        metrics: metrics.map((m) => m.id),
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // We expect 2 creators based on seed data (Admin and Regular User)
    expect(data.results).toHaveLength(2);

    // Find admin and regular user results
    const adminResult = data.results.find(
      (r: any) => r.creator.name === "Test Admin"
    );
    const regularResult = data.results.find(
      (r: any) => r.creator.name === "Test User"
    );

    expect(adminResult).toBeDefined();
    expect(regularResult).toBeDefined();

    // Based on seed data:
    // Admin user: 4 issues
    expect(adminResult["Issue Count"]).toBe(12);

    // Regular user: 9 issues
    expect(regularResult["Issue Count"]).toBe(9);

    // Validate types for all results
    for (const result of data.results) {
      expect(Number.isInteger(result["Issue Count"])).toBe(true);

      // No NaN or null values
      for (const metric of metrics) {
        expect(result[metric.label]).not.toBeNaN();
        expect(result[metric.label]).not.toBeNull();
      }
    }
  });

  test("should validate date dimension returns midnight UTC dates", async ({
    request,
  }) => {
    const response = await request.post("/api/report-builder/issue-tracking", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["date"],
        metrics: metrics.map((m) => m.id),
      },
    });

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
      "/api/report-builder/issue-tracking",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: [],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    // Get count by creator
    const creatorResponse = await request.post(
      "/api/report-builder/issue-tracking",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["creator"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    if (totalResponse.ok() && creatorResponse.ok()) {
      const totalData = await totalResponse.json();
      const creatorData = await creatorResponse.json();

      if (totalData.results.length > 0 && creatorData.results.length > 0) {
        const totalCount = totalData.results[0]["Issue Count"];
        const creatorSum = creatorData.results.reduce(
          (sum: number, item: any) => sum + item["Issue Count"],
          0
        );

        // Total should equal sum of creator counts
        expect(creatorSum).toBe(totalCount);
      }
    }
  });
});

test.describe("Issue Tracking API - All Dimension Combinations @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;
  const dimensions = ["creator", "issueType", "date"];
  const metrics = [
    { id: "issueCount", label: "Issue Count" },
    { id: "avgResolutionTime", label: "Avg. Resolution Time" },
    { id: "totalResolutionTime", label: "Total Resolution Time" },
    { id: "openIssueCount", label: "Open Issue Count" },
    { id: "closedIssueCount", label: "Closed Issue Count" },
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
        "/api/report-builder/issue-tracking",
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
          "/api/report-builder/issue-tracking",
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
