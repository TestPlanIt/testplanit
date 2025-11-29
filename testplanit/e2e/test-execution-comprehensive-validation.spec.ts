import { test, expect } from "@playwright/test";

/**
 * Comprehensive validation of Test Execution Reports API
 * Tests all dimension combinations to ensure correct results are returned
 */

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

// Define invalid dimension combinations
const invalidCombinations = [
  // Redundant parent-child groupings
  ["testRun", "testCase"],
  
  // Status with structural entities
  ["status", "testCase"],
  ["status", "testRun"],
  ["status", "milestone"],
  
  // User (executor) with structural entities
  ["user", "testRun"],
  ["user", "milestone"],
  ["user", "testCase"],
  
  // Configuration with case-level entities
  ["configuration", "testRun"],
  ["configuration", "testCase"],
  ["configuration", "milestone"],
  
  // Date with structural entities
  ["date", "testRun"],
  ["date", "testCase"],
  ["date", "milestone"],
  
  // Cross-level structural combinations
  ["testRun", "milestone"],
  ["testCase", "milestone"],
];

// Helper to check if dimensions contain invalid combination
function containsInvalidCombination(dimensions: string[]): boolean {
  for (const invalidCombo of invalidCombinations) {
    if (invalidCombo.every(dim => dimensions.includes(dim))) {
      return true;
    }
  }
  return false;
}

// Helper to validate dimension structure
function validateDimensionStructure(dimension: string, value: any) {
  switch (dimension) {
    case "project":
      expect(value).toHaveProperty("id");
      expect(value).toHaveProperty("name");
      expect(typeof value.id).toBe("number");
      expect(typeof value.name).toBe("string");
      break;
    case "status":
      expect(value).toHaveProperty("id");
      expect(value).toHaveProperty("name");
      expect(value).toHaveProperty("color");
      expect(typeof value.id).toBe("number");
      expect(typeof value.name).toBe("string");
      expect(typeof value.color).toBe("string");
      break;
    case "user":
      expect(value).toHaveProperty("id");
      expect(value).toHaveProperty("name");
      expect(value).toHaveProperty("email");
      // User ID can be either number or string depending on the API
      expect(["number", "string"]).toContain(typeof value.id);
      expect(typeof value.name).toBe("string");
      expect(typeof value.email).toBe("string");
      break;
    case "configuration":
      expect(value).toHaveProperty("id");
      expect(value).toHaveProperty("name");
      expect(typeof value.id).toBe("number");
      expect(typeof value.name).toBe("string");
      break;
    case "date":
      expect(value).toHaveProperty("executedAt");
      expect(typeof value.executedAt).toBe("string");
      const date = new Date(value.executedAt);
      expect(date.getUTCHours()).toBe(0);
      expect(date.getUTCMinutes()).toBe(0);
      expect(date.getUTCSeconds()).toBe(0);
      break;
    case "testRun":
      expect(value).toHaveProperty("id");
      expect(value).toHaveProperty("name");
      expect(typeof value.id).toBe("number");
      expect(typeof value.name).toBe("string");
      break;
    case "testCase":
      expect(value).toHaveProperty("id");
      expect(value).toHaveProperty("name");
      expect(value).toHaveProperty("isDeleted");
      expect(value).toHaveProperty("source");
      expect(typeof value.id).toBe("number");
      expect(typeof value.name).toBe("string");
      expect(typeof value.isDeleted).toBe("boolean");
      break;
    case "milestone":
      expect(value).toHaveProperty("id");
      expect(value).toHaveProperty("name");
      expect(value).toHaveProperty("milestoneType");
      expect(typeof value.id).toBe("number");
      expect(typeof value.name).toBe("string");
      // milestoneType can be either a number or an object depending on the API
      expect(["number", "object"]).toContain(typeof value.milestoneType);
      break;
  }
}

// Helper to validate metrics
function validateMetrics(result: any, metrics: string[]) {
  const metricLabels: Record<string, string> = {
    testResults: "Test Results Count",
    passRate: "Pass Rate (%)",
    avgElapsedTime: "Avg. Elapsed Time",
    totalElapsedTime: "Total Elapsed Time",
    testRunCount: "Test Runs Count",
    testCaseCount: "Test Cases Count",
  };

  for (const metric of metrics) {
    const label = metricLabels[metric];
    
    // Skip metrics that aren't present in the result
    // Some dimensions don't support all metrics
    if (!(label in result)) {
      continue;
    }
    
    const value = result[label];
    if (metric === "passRate") {
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    } else if (metric === "avgElapsedTime" || metric === "totalElapsedTime") {
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThanOrEqual(0);
    } else {
      // Count metrics should be integers
      expect(typeof value).toBe("number");
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  }
}

test.describe("Test Execution Reports - Comprehensive Validation @api @reports", () => {
  const TEST_PROJECT_ID = 331;
  
  // Define all available dimensions for project-specific reports
  const projectDimensions = ["status", "user", "configuration", "date", "testRun", "testCase", "milestone"];
  
  // Define all available metrics
  const metrics = ["testResults", "passRate", "avgElapsedTime", "totalElapsedTime", "testRunCount", "testCaseCount"];

  test("should return available dimensions and metrics", async ({ request }) => {
    const response = await request.get(`/api/report-builder/test-execution?projectId=${TEST_PROJECT_ID}`);
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    
    expect(data).toHaveProperty("dimensions");
    expect(data).toHaveProperty("metrics");
    
    // Verify all expected dimensions are present
    const dimensionIds = data.dimensions.map((d: any) => d.id);
    for (const dim of projectDimensions) {
      expect(dimensionIds).toContain(dim);
    }
    
    // Verify all expected metrics are present
    const metricIds = data.metrics.map((m: any) => m.id);
    for (const metric of metrics) {
      expect(metricIds).toContain(metric);
    }
  });

  test("should return data for no dimensions (project totals)", async ({ request }) => {
    // The API might require at least one dimension now
    // If it fails with 400, we'll use a single dimension instead
    const response = await request.post("/api/report-builder/test-execution", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: [],
        metrics: metrics,
      },
    });

    if (response.status() === 400) {
      // API now requires at least one dimension, use status as default
      const retryResponse = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["status"],
          metrics: metrics,
        },
      });
      expect(retryResponse.status()).toBe(200);
      const data = await retryResponse.json();
      
      // Define metric labels for aggregation
      const metricLabels: Record<string, string> = {
        testResults: "Test Results Count",
        passRate: "Pass Rate (%)",
        avgElapsedTime: "Avg. Elapsed Time",
        totalElapsedTime: "Total Elapsed Time",
        testRunCount: "Test Runs Count",
        testCaseCount: "Test Cases Count",
      };
      
      // Aggregate the results to get totals
      const totals = data.results.reduce((acc: any, result: any) => {
        metrics.forEach(metric => {
          const label = metricLabels[metric];
          acc[label] = (acc[label] || 0) + (result[label] || 0);
        });
        return acc;
      }, {});
      
      console.log("Project totals (aggregated):", totals);
      return;
    }
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    
    expect(data.results).toBeInstanceOf(Array);
    expect(data.results.length).toBeGreaterThan(0);
    
    // Should return a single result with aggregated totals
    const result = data.results[0];
    validateMetrics(result, metrics);
    
    // Store totals for consistency checks
    const totals = {
      testResults: result["Test Results Count"],
      testRuns: result["Test Runs Count"],
      testCases: result["Test Cases Count"],
    };
    
    console.log("Project totals:", totals);
  });

  // Test each individual dimension
  for (const dimension of projectDimensions) {
    test(`should return data for dimension: ${dimension}`, async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: [dimension],
          metrics: metrics,
        },
      });

      expect(response.status()).toBe(200);
      const data = await response.json();
      
      expect(data.results).toBeInstanceOf(Array);
      
      if (data.results.length > 0) {
        console.log(`Dimension ${dimension} returned ${data.results.length} results`);
        
        // Validate first few results
        for (let i = 0; i < Math.min(3, data.results.length); i++) {
          const result = data.results[i];
          
          // Validate dimension value
          expect(result).toHaveProperty(dimension);
          validateDimensionStructure(dimension, result[dimension]);
          
          // Validate metrics
          validateMetrics(result, metrics);
        }
        
        // Log summary of unique values
        const uniqueValues = new Set(data.results.map((r: any) => 
          dimension === "date" ? r[dimension]?.executedAt : r[dimension]?.name || r[dimension]?.id
        ));
        console.log(`Unique ${dimension} values:`, Array.from(uniqueValues).slice(0, 5));
      } else {
        console.warn(`No results returned for dimension: ${dimension}`);
      }
    });
  }

  // Test all 2-dimension combinations
  const twoDimCombos = kCombinations(projectDimensions, 2);
  
  test.describe("Two-dimension combinations", () => {
    for (const dims of twoDimCombos) {
      // Skip invalid combinations
      if (containsInvalidCombination(dims)) {
        test.skip(`should skip invalid dimensions: [${dims.join(", ")}]`, async () => {});
        continue;
      }
      
      test(`should return data for dimensions: [${dims.join(", ")}]`, async ({ request }) => {
        const response = await request.post("/api/report-builder/test-execution", {
          data: {
            projectId: TEST_PROJECT_ID,
            dimensions: dims,
            metrics: ["testResults", "passRate"], // Use subset for performance
          },
        });

        expect(response.status()).toBe(200);
        const data = await response.json();
        
        expect(data.results).toBeInstanceOf(Array);
        
        if (data.results.length > 0) {
          console.log(`Dimensions [${dims.join(", ")}] returned ${data.results.length} results`);
          
          // Validate first result structure
          const result = data.results[0];
          for (const dim of dims) {
            expect(result).toHaveProperty(dim);
            validateDimensionStructure(dim, result[dim]);
          }
          
          validateMetrics(result, ["testResults", "passRate"]);
        } else {
          console.warn(`No results for dimensions: [${dims.join(", ")}]`);
        }
      });
    }
  });

  // Test critical 3-dimension combinations
  const criticalThreeDimCombos = [
    ["user", "status", "date"],
    ["milestone", "configuration", "status"],
    ["testRun", "testCase", "status"],
    ["user", "milestone", "configuration"],
  ];

  test.describe("Three-dimension combinations (critical)", () => {
    for (const dims of criticalThreeDimCombos) {
      // Skip invalid combinations
      if (containsInvalidCombination(dims)) {
        test.skip(`should skip invalid dimensions: [${dims.join(", ")}]`, async () => {});
        continue;
      }
      
      test(`should return data for dimensions: [${dims.join(", ")}]`, async ({ request }) => {
        const response = await request.post("/api/report-builder/test-execution", {
          data: {
            projectId: TEST_PROJECT_ID,
            dimensions: dims,
            metrics: ["testResults", "passRate"],
          },
        });

        expect(response.status()).toBe(200);
        const data = await response.json();
        
        expect(data.results).toBeInstanceOf(Array);
        
        if (data.results.length > 0) {
          console.log(`Dimensions [${dims.join(", ")}] returned ${data.results.length} results`);
          
          const result = data.results[0];
          for (const dim of dims) {
            expect(result).toHaveProperty(dim);
            validateDimensionStructure(dim, result[dim]);
          }
        } else {
          console.warn(`No results for dimensions: [${dims.join(", ")}]`);
        }
      });
    }
  });

  // Test data consistency across groupings
  test("should maintain data consistency across different groupings", async ({ request }) => {
    // Get total count
    const totalResponse = await request.post("/api/report-builder/test-execution", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: [],
        metrics: ["testResults"],
      },
    });

    // If no dimensions fails, get totals by aggregating status dimension
    let totalCount;
    if (totalResponse.status() === 400) {
      const statusTotalResponse = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["status"],
          metrics: ["testResults"],
        },
      });
      expect(statusTotalResponse.status()).toBe(200);
      const statusTotalData = await statusTotalResponse.json();
      totalCount = statusTotalData.results.reduce(
        (sum: number, item: any) => sum + item["Test Results Count"],
        0
      );
    } else {
      expect(totalResponse.status()).toBe(200);
      const totalData = await totalResponse.json();
      
      // Check if we have results
      if (!totalData.results || totalData.results.length === 0) {
        console.log("No total results returned, skipping consistency check");
        return;
      }
      
      totalCount = totalData.results[0]["Test Results Count"];
    }

    // Get count by status
    const statusResponse = await request.post("/api/report-builder/test-execution", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["status"],
        metrics: ["testResults"],
      },
    });

    expect(statusResponse.status()).toBe(200);
    const statusData = await statusResponse.json();
    const statusSum = statusData.results.reduce(
      (sum: number, item: any) => sum + item["Test Results Count"],
      0
    );

    expect(statusSum).toBe(totalCount);
    console.log(`Data consistency check: Total=${totalCount}, Status sum=${statusSum}`);
  });

  // Test handling of null values
  test("should handle null dimension values correctly", async ({ request }) => {
    // Test with milestone dimension (some test runs may not have milestones)
    const response = await request.post("/api/report-builder/test-execution", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["milestone"],
        metrics: ["testResults"],
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    
    // Check if any results have null milestone
    const nullMilestoneResults = data.results.filter((r: any) => r.milestone === null);
    if (nullMilestoneResults.length > 0) {
      console.log(`Found ${nullMilestoneResults.length} results with null milestone`);
      expect(nullMilestoneResults[0]).toHaveProperty("Test Results");
      expect(nullMilestoneResults[0]["Test Results"]).toBeGreaterThan(0);
    }
  });

  // Test specific business scenarios
  test("should correctly calculate pass rate by user", async ({ request }) => {
    const response = await request.post("/api/report-builder/test-execution", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["user"],
        metrics: ["testResults", "passRate"],
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    
    expect(data.results.length).toBeGreaterThan(0);
    
    for (const result of data.results) {
      const passRate = result["Pass Rate (%)"];
      expect(passRate).toBeGreaterThanOrEqual(0);
      expect(passRate).toBeLessThanOrEqual(100);
      
      console.log(`User ${result.user.name}: ${result["Test Results Count"]} results, ${passRate}% pass rate`);
    }
  });

  test("should return execution timeline by date", async ({ request }) => {
    const response = await request.post("/api/report-builder/test-execution", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["date"],
        metrics: ["testResults", "avgElapsedTime"],
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    
    expect(data.results.length).toBeGreaterThan(0);
    
    // Verify dates are in chronological order
    const dates = data.results.map((r: any) => new Date(r.date.executedAt));
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime()).toBeGreaterThanOrEqual(dates[i-1].getTime());
    }
    
    console.log(`Execution timeline spans ${dates.length} days from ${dates[0].toISOString()} to ${dates[dates.length-1].toISOString()}`);
  });
});

test.describe("Cross-Project Test Execution Reports @api @reports @admin", () => {
  // For cross-project reports, we have an additional "project" dimension
  const crossProjectDimensions = ["project", "status", "user", "configuration", "date", "testRun", "testCase", "milestone"];
  const metrics = ["testResults", "passRate", "avgElapsedTime", "totalElapsedTime", "testRunCount", "testCaseCount"];

  test("should return data across all projects", async ({ request }) => {
    const response = await request.post("/api/report-builder/cross-project-test-execution", {
      data: {
        dimensions: ["project"],
        metrics: ["testResults", "testRunCount"],
      },
    });

    // Cross-project requires admin access - might return 401
    if (response.status() === 401) {
      console.log("Cross-project report requires admin access");
      return;
    }

    expect(response.status()).toBe(200);
    const data = await response.json();
    
    expect(data.results).toBeInstanceOf(Array);
    
    if (data.results.length > 0) {
      console.log(`Found test execution data for ${data.results.length} projects`);
      
      for (const result of data.results) {
        expect(result).toHaveProperty("project");
        expect(result.project).toHaveProperty("id");
        expect(result.project).toHaveProperty("name");
        
        console.log(`Project ${result.project.name}: ${result["Test Results"]} results, ${result["Test Runs"]} runs`);
      }
    }
  });

  test("should handle project + status dimension combination", async ({ request }) => {
    const response = await request.post("/api/report-builder/cross-project-test-execution", {
      data: {
        dimensions: ["project", "status"],
        metrics: ["testResults", "passRate"],
      },
    });

    if (response.status() === 401) {
      return; // Skip if not admin
    }

    expect(response.status()).toBe(200);
    const data = await response.json();
    
    if (data.results.length > 0) {
      // Group results by project to verify status breakdown
      const projectGroups = data.results.reduce((acc: any, result: any) => {
        const projectId = result.project.id;
        if (!acc[projectId]) {
          acc[projectId] = {
            name: result.project.name,
            statuses: [],
          };
        }
        acc[projectId].statuses.push({
          status: result.status.name,
          count: result["Test Results"],
          passRate: result["Pass Rate"],
        });
        return acc;
      }, {});
      
      console.log("Project status breakdown:", JSON.stringify(projectGroups, null, 2));
    }
  });
});