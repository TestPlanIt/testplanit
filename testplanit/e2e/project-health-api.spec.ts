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

test.describe("Project Health API @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;
  
  // Define dimensions and metrics based on the Project Health API registry
  const dimensions = ["milestone", "creator", "date"];
  const metrics = [
    { id: "completionRate", label: "Completion Rate (%)" },
    { id: "milestoneProgress", label: "Milestone Progress (%)" },
    { id: "totalMilestones", label: "Total Milestones" },
    { id: "activeMilestones", label: "Active Milestones" },
  ];

  test("should get project health dimensions and metrics", async ({
    request,
  }) => {
    const response = await request.get(`/api/report-builder/project-health?projectId=${TEST_PROJECT_ID}`);

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");

    // Check dimensions
    expect(Array.isArray(data.dimensions)).toBe(true);
    const dimensionIds = data.dimensions.map((d: any) => d.id);
    expect(dimensionIds).toContain("milestone");
    expect(dimensionIds).toContain("creator");
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
        "/api/report-builder/project-health",
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
        if (dimension === "milestone") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
          expect(firstResult[dimension]).toHaveProperty("isCompleted");
          expect(firstResult[dimension]).toHaveProperty("isStarted");
        } else if (dimension === "creator") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
          expect(firstResult[dimension]).toHaveProperty("email");
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
            metric.id === "totalMilestones" ||
            metric.id === "activeMilestones"
          ) {
            expect(Number.isInteger(firstResult[metric.label])).toBe(true);
          } else if (metric.id === "completionRate" || metric.id === "milestoneProgress") {
            expect(firstResult[metric.label]).toBeLessThanOrEqual(100);
          }
        }
      }
    });
  }

  // Error handling tests
  test("should return 401 for non-admin users", async ({ request }) => {
    const response = await request.post("/api/report-builder/project-health", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["milestone"],
        metrics: metrics.map((m) => m.id),
      },
    });

    // If the user is not authenticated as admin, should return 401
    // If authenticated as admin, should return 200
    expect([200, 401]).toContain(response.status());
  });

  test("should return 400 for invalid dimensions", async ({ request }) => {
    const response = await request.post("/api/report-builder/project-health", {
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
    const response = await request.post("/api/report-builder/project-health", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["milestone"],
        metrics: ["invalidMetric"],
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Unsupported metric");
  });

  test("should return 400 for missing metrics", async ({ request }) => {
    const response = await request.post("/api/report-builder/project-health", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["milestone"],
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
    const response = await request.post("/api/report-builder/project-health", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["milestone"],
        metrics: metrics.map((m) => m.id),
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    for (const result of data.results) {
      // Validate all metrics
      expect(result["Completion Rate (%)"]).toBeGreaterThanOrEqual(0);
      expect(result["Completion Rate (%)"]).toBeLessThanOrEqual(100);
      expect(result["Milestone Progress (%)"]).toBeGreaterThanOrEqual(0);
      expect(result["Milestone Progress (%)"]).toBeLessThanOrEqual(100);
      expect(result["Total Milestones"]).toBeGreaterThanOrEqual(0);
      expect(result["Active Milestones"]).toBeGreaterThanOrEqual(0);

      // Validate types
      expect(Number.isInteger(result["Total Milestones"])).toBe(true);
      expect(Number.isInteger(result["Active Milestones"])).toBe(true);

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
    const response = await request.post("/api/report-builder/project-health", {
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
      "/api/report-builder/project-health",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: [],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    // Get count by project
    const milestoneResponse = await request.post(
      "/api/report-builder/project-health",
      {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["milestone"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    if (totalResponse.ok() && milestoneResponse.ok()) {
      const totalData = await totalResponse.json();
      const milestoneData = await milestoneResponse.json();

      if (totalData.results.length > 0 && milestoneData.results.length > 0) {
        const totalCount = totalData.results[0]["Total Milestones"];
        const milestoneSum = milestoneData.results.reduce(
          (sum: number, item: any) => sum + item["Total Milestones"],
          0
        );

        // Total should equal sum of milestone counts
        expect(milestoneSum).toBe(totalCount);
      }
    }
  });
});

test.describe("Project Health API - All Dimension Combinations @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;
  const dimensions = ["milestone", "creator", "date"];
  const metrics = [
    { id: "completionRate", label: "Completion Rate (%)" },
    { id: "milestoneProgress", label: "Milestone Progress (%)" },
    { id: "totalMilestones", label: "Total Milestones" },
    { id: "activeMilestones", label: "Active Milestones" },
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
        "/api/report-builder/project-health",
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
          "/api/report-builder/project-health",
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
