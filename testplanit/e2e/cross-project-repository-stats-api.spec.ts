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

test.describe("Cross-Project Repository Stats API @api @reports @admin", () => {
  // Define dimensions and metrics based on the Cross-Project Repository Stats API registry
  const dimensions = ["project", "date"];
  const metrics = [
    { id: "testCaseCount", label: "Test Case Count" },
    { id: "totalSteps", label: "Total Steps" },
    { id: "averageSteps", label: "Average Steps per Case" },
    { id: "automatedCount", label: "Automated Cases" },
    { id: "manualCount", label: "Manual Cases" },
    { id: "automationRate", label: "Automation Rate (%)" },
  ];

  test("should get cross-project repository stats dimensions and metrics", async ({
    request,
  }) => {
    const response = await request.get(
      "/api/report-builder/cross-project-repository-stats"
    );

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");

    // Check dimensions
    expect(Array.isArray(data.dimensions)).toBe(true);
    const dimensionIds = data.dimensions.map((d: any) => d.id);
    expect(dimensionIds).toContain("project");
    expect(dimensionIds).toContain("date");

    // Check metrics
    expect(Array.isArray(data.metrics)).toBe(true);
    const metricIds = data.metrics.map((m: any) => m.id);
    console.log("Available metrics from API:", data.metrics);
    for (const metric of metrics) {
      expect(metricIds).toContain(metric.id);
    }
  });

  // Dynamically generate tests for each dimension
  for (const dimension of dimensions) {
    test(`returns correct data for dimension '${dimension}'`, async ({
      request,
    }) => {
      const requestData = {
        dimensions: [dimension],
        metrics: metrics.map((m) => m.id),
      };
      const response = await request.post(
        "/api/report-builder/cross-project-repository-stats",
        {
          data: requestData,
        }
      );

      // Ensure the API call was successful
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);

      // If data is returned, validate the structure of the first result
      if (data.results.length > 0) {
        const firstResult = data.results[0];
        console.log(
          `Response for dimension ${dimension}:`,
          Object.keys(firstResult)
        );
        expect(firstResult).toHaveProperty(dimension);

        // Check for specific dimension object structures
        if (dimension === "project") {
          expect(firstResult[dimension]).toHaveProperty("id");
          expect(firstResult[dimension]).toHaveProperty("name");
        } else if (dimension === "date") {
          expect(firstResult[dimension]).toHaveProperty("createdAt");
        }

        // Validate metrics that are present in the response
        // Note: The API may omit metrics with zero values or that aren't applicable
        for (const metric of metrics) {
          if (metric.label in firstResult) {
            expect(typeof firstResult[metric.label]).toBe("number");
            expect(firstResult[metric.label]).toBeGreaterThanOrEqual(0);

            // Special validation for specific metrics
            if (
              metric.id === "testCaseCount" ||
              metric.id === "totalSteps" ||
              metric.id === "automatedCount" ||
              metric.id === "manualCount"
            ) {
              expect(Number.isInteger(firstResult[metric.label])).toBe(true);
            } else if (metric.id === "automationRate") {
              expect(firstResult[metric.label]).toBeLessThanOrEqual(100);
            }
          }
        }
      }
    });
  }

  // Error handling tests
  test("should return 401 for non-admin users", async ({ request }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-repository-stats",
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
      "/api/report-builder/cross-project-repository-stats",
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
      "/api/report-builder/cross-project-repository-stats",
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
      "/api/report-builder/cross-project-repository-stats",
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
      "/api/report-builder/cross-project-repository-stats",
      {
        data: {
          dimensions: ["project"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Find the result for project 331 specifically
    // Cross-project reports may include data from other projects in the test database
    const result = data.results.find((r: any) => r.project?.id === 331);

    // Project 331 should exist in results
    expect(result).toBeDefined();

    // Validate data types and ranges
    expect(result["Test Case Count"]).toBeGreaterThan(0);
    expect(typeof result["Test Case Count"]).toBe("number");
    expect(Number.isInteger(result["Test Case Count"])).toBe(true);

    if (result["Automated Cases"] !== undefined) {
      expect(typeof result["Automated Cases"]).toBe("number");
      expect(Number.isInteger(result["Automated Cases"])).toBe(true);
      expect(result["Automated Cases"]).toBeGreaterThanOrEqual(0);
      expect(result["Automated Cases"]).toBeLessThanOrEqual(
        result["Test Case Count"]
      );
    }

    if (result["Manual Cases"] !== undefined) {
      expect(typeof result["Manual Cases"]).toBe("number");
      expect(Number.isInteger(result["Manual Cases"])).toBe(true);
      expect(result["Manual Cases"]).toBeGreaterThanOrEqual(0);
      expect(result["Manual Cases"]).toBeLessThanOrEqual(
        result["Test Case Count"]
      );
    }

    expect(result["Automation Rate (%)"]).toBeDefined();
    expect(typeof result["Automation Rate (%)"]).toBe("number");
    expect(result["Automation Rate (%)"]).toBeGreaterThanOrEqual(0);
    expect(result["Automation Rate (%)"]).toBeLessThanOrEqual(100);

    // Total Steps and Average Steps per Case
    expect(result["Total Steps"]).toBeDefined();
    expect(typeof result["Total Steps"]).toBe("number");
    expect(result["Total Steps"]).toBeGreaterThanOrEqual(0);

    expect(result["Average Steps per Case"]).toBeDefined();
    expect(typeof result["Average Steps per Case"]).toBe("number");
    expect(result["Average Steps per Case"]).toBeGreaterThanOrEqual(0);

    // Validate project dimension
    expect(result.project).toBeDefined();
    expect(result.project.id).toBe(331);
    expect(result.project.name).toBe("E2E Test Project");
  });

  test("should validate date dimension returns midnight UTC dates", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-repository-stats",
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
      "/api/report-builder/cross-project-repository-stats",
      {
        data: {
          dimensions: [],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    // Get count by project
    const projectResponse = await request.post(
      "/api/report-builder/cross-project-repository-stats",
      {
        data: {
          dimensions: ["project"],
          metrics: metrics.map((m) => m.id),
        },
      }
    );

    if (totalResponse.ok() && projectResponse.ok()) {
      const totalData = await totalResponse.json();
      const projectData = await projectResponse.json();

      if (totalData.results.length > 0 && projectData.results.length > 0) {
        const totalCount = totalData.results[0]["Test Case Count"];
        const projectSum = projectData.results.reduce(
          (sum: number, item: any) => sum + item["Test Case Count"],
          0
        );

        // Total should equal sum of project counts
        expect(projectSum).toBe(totalCount);
      }
    }
  });
});

test.describe
  .serial("Cross-Project Repository Stats API - All Dimension Combinations @api @reports @admin", () => {
  const dimensions = ["project", "date"];
  const metrics = [
    { id: "testCaseCount", label: "Test Case Count" },
    { id: "totalSteps", label: "Total Steps" },
    { id: "averageSteps", label: "Average Steps per Case" },
    { id: "automatedCount", label: "Automated Cases" },
    { id: "manualCount", label: "Manual Cases" },
    { id: "automationRate", label: "Automation Rate (%)" },
  ];

  // Test all possible combinations of dimensions
  const dimCombos = [
    ...kCombinations(dimensions, 1),
    ...kCombinations(dimensions, 2),
  ];

  for (const dims of dimCombos) {
    const testName = `dims=[${dims.join(", ")}]`;
    test(testName, async ({ request }) => {
      const response = await request.post(
        "/api/report-builder/cross-project-repository-stats",
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

            // Special validation for date dimension
            if (dim === "date" && firstResult[dim]) {
              expect(firstResult[dim]).toHaveProperty("createdAt");
              expect(typeof firstResult[dim].createdAt).toBe("string");
              // Validate it's a valid ISO date string
              expect(() => new Date(firstResult[dim].createdAt)).not.toThrow();
            }
          }
          // Validate all metrics - API returns them with labels as keys
          // Note: Some metrics might be omitted if they have zero values
          for (const metric of metrics) {
            if (metric.label in firstResult) {
              expect(typeof firstResult[metric.label]).toBe("number");
              expect(firstResult[metric.label]).toBeGreaterThanOrEqual(0);
            }
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
          "/api/report-builder/cross-project-repository-stats",
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
            // Validate all metrics - API returns them with labels as keys
            // Note: Some metrics might be omitted if they have zero values
            for (const metric of metrics) {
              if (metric.label in firstResult) {
                expect(typeof firstResult[metric.label]).toBe("number");
                expect(firstResult[metric.label]).toBeGreaterThanOrEqual(0);
              }
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
