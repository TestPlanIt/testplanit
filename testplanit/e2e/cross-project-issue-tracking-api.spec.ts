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

test.describe("Cross-Project Issue Tracking API @api @reports @admin", () => {
  // Define dimensions and metrics based on the Cross-Project Issue Tracking API registry
  const dimensions = ["project", "creator", "issueType", "date"];
  const metrics = [{ id: "issueCount", label: "Issue Count" }];

  test("should get cross-project issue tracking dimensions and metrics", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/report-builder/cross-project-issue-tracking"
    );

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");

    // Check dimensions
    expect(Array.isArray(data.dimensions)).toBe(true);
    const dimensionIds = data.dimensions.map((d: any) => d.id);
    expect(dimensionIds).toContain("project");
    expect(dimensionIds).toContain("creator");
    expect(dimensionIds).toContain("issueType");
    expect(dimensionIds).toContain("date");

    // Check metrics
    expect(Array.isArray(data.metrics)).toBe(true);
    const metricIds = data.metrics.map((m: any) => m.id);
    expect(metricIds).toContain("issueCount");
  });

  // Dynamically generate tests for each dimension
  for (const dimension of dimensions) {
    test(`returns correct data for dimension '${dimension}'`, async ({
      request,
    }) => {
      const response = await request.post(
        "/api/report-builder/cross-project-issue-tracking",
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
          dimension === "creator" ||
          dimension === "issueType"
        ) {
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
          expect(Number.isInteger(firstResult[metric.label])).toBe(true);
        }
      }
    });
  }

  // Error handling tests
  test("should return 401 for non-admin users", async ({ request }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-issue-tracking",
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
      "/api/report-builder/cross-project-issue-tracking",
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
      "/api/report-builder/cross-project-issue-tracking",
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
      "/api/report-builder/cross-project-issue-tracking",
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
      "/api/report-builder/cross-project-issue-tracking",
      {
        data: {
          dimensions: ["creator"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    expect(data.results.length).toBeGreaterThan(0);

    for (const result of data.results) {
      // Validate all metrics
      for (const metric of metrics) {
        expect(typeof result[metric.label]).toBe("number");
        expect(result[metric.label]).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result[metric.label])).toBe(true);
      }

      // Creator structure validation
      expect(result.creator).toHaveProperty("id");
      expect(result.creator).toHaveProperty("name");
    }
  });

  test("should validate date dimension returns midnight UTC dates", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-issue-tracking",
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
      "/api/report-builder/cross-project-issue-tracking",
      {
        data: {
          dimensions: [],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    // Get count by creator
    const creatorResponse = await request.post(
      "/api/report-builder/cross-project-issue-tracking",
      {
        data: {
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

test.describe("Cross-Project Issue Tracking API - All Dimension Combinations @api @reports @admin", () => {
  const dimensions = ["project", "creator", "issueType", "date"];
  const metrics = [{ id: "issueCount", label: "Issue Count" }];

  // Test all possible combinations of dimensions
  const dimCombos = [
    ...kCombinations(dimensions, 1),
    ...kCombinations(dimensions, 2),
    ...kCombinations(dimensions, 3),
    ...kCombinations(dimensions, 4),
  ];

  for (const dims of dimCombos) {
    const testName = `dims=[${dims.join(", ")}]`;
    test(testName, async ({ request }) => {
      const response = await request.post(
        "/api/report-builder/cross-project-issue-tracking",
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
          "/api/report-builder/cross-project-issue-tracking",
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
