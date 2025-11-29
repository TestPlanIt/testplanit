import { test, expect } from "@playwright/test";

/**
 * Test validation of invalid dimension combinations for Test Execution Reports
 */

test.describe("Test Execution Reports - Invalid Dimension Combinations @api @reports", () => {
  const TEST_PROJECT_ID = 331;
  
  // Define all invalid dimension combinations that should be rejected
  const invalidCombinations = [
    // Redundant parent-child groupings
    { dims: ["testRun", "testCase"], expectedError: "The 'testRun' and 'testCase' dimensions cannot be used together" },
    
    // Status with structural entities
    { dims: ["status", "testCase"], expectedError: "The 'status' and 'testCase' dimensions cannot be used together" },
    { dims: ["status", "testRun"], expectedError: "The 'status' and 'testRun' dimensions cannot be used together" },
    { dims: ["status", "milestone"], expectedError: "The 'status' and 'milestone' dimensions cannot be used together" },
    
    // User (executor) with structural entities
    { dims: ["user", "testRun"], expectedError: "The 'user' and 'testRun' dimensions cannot be used together" },
    { dims: ["user", "milestone"], expectedError: "The 'user' and 'milestone' dimensions cannot be used together" },
    { dims: ["user", "testCase"], expectedError: "The 'user' and 'testCase' dimensions cannot be used together" },
    
    // Configuration with case-level entities
    { dims: ["configuration", "testRun"], expectedError: "The 'configuration' and 'testRun' dimensions cannot be used together" },
    { dims: ["configuration", "testCase"], expectedError: "The 'configuration' and 'testCase' dimensions cannot be used together" },
    { dims: ["configuration", "milestone"], expectedError: "The 'configuration' and 'milestone' dimensions cannot be used together" },
    
    // Date with structural entities
    { dims: ["date", "testRun"], expectedError: "The 'date' and 'testRun' dimensions cannot be used together" },
    { dims: ["date", "testCase"], expectedError: "The 'date' and 'testCase' dimensions cannot be used together" },
    { dims: ["date", "milestone"], expectedError: "The 'date' and 'milestone' dimensions cannot be used together" },
    
    // Cross-level structural combinations
    { dims: ["testRun", "milestone"], expectedError: "The 'testRun' and 'milestone' dimensions cannot be used together" },
    { dims: ["testCase", "milestone"], expectedError: "The 'testCase' and 'milestone' dimensions cannot be used together" },
  ];

  // Test each invalid combination
  for (const { dims, expectedError } of invalidCombinations) {
    test(`should reject invalid combination: [${dims.join(", ")}]`, async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: dims,
          metrics: ["testResults", "passRate"],
        },
      });

      expect(response.status()).toBe(400);
      const data = await response.json();
      
      expect(data.error).toBeDefined();
      expect(data.error).toContain(expectedError);
      
      // Verify the error contains the dimension names
      for (const dim of dims) {
        expect(data.error).toContain(dim);
      }
    });
  }

  test("should allow valid combinations with three dimensions", async ({ request }) => {
    // Test a valid 3-dimension combination to ensure we're not blocking all multi-dimension requests
    const response = await request.post("/api/report-builder/test-execution", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["user", "status", "date"],
        metrics: ["testResults"],
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);
  });

  test("should still allow single dimensions", async ({ request }) => {
    // Ensure single dimensions still work
    const response = await request.post("/api/report-builder/test-execution", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["milestone"],
        metrics: ["testResults"],
      },
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);
  });

  test("should reject invalid combinations even with additional valid dimensions", async ({ request }) => {
    // Test that adding a third valid dimension doesn't bypass the validation
    const response = await request.post("/api/report-builder/test-execution", {
      data: {
        projectId: TEST_PROJECT_ID,
        dimensions: ["user", "testRun", "date"], // user + testRun is invalid
        metrics: ["testResults"],
      },
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("The 'user' and 'testRun' dimensions cannot be used together");
  });

  test("should work for cross-project test execution with same rules", async ({ request }) => {
    // Test that the same rules apply to cross-project reports
    const response = await request.post("/api/report-builder/cross-project-test-execution", {
      data: {
        dimensions: ["project", "status", "testCase"], // status + testCase is invalid
        metrics: ["testResults"],
      },
    });

    // Might get 401 if not admin, but if authenticated as admin should get 400
    if (response.status() !== 401) {
      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("The 'status' and 'testCase' dimensions cannot be used together");
    }
  });
});