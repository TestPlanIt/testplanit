import { test, expect } from "../../fixtures";

/**
 * Test Run Summary API Tests
 *
 * These tests verify that the test run summary API endpoints work correctly
 * and don't cause infinite skeleton loading due to database connection issues.
 *
 * The bug being tested: API routes were creating new PrismaClient instances
 * which exhausted the connection pool in dev mode, causing requests to hang.
 */
test.describe("Test Run Summary API", () => {
  test("test run summary API responds successfully", async ({ page, request, projectId }) => {
    // Create a test run using the API
    const testRun = await request.post(`/api/model/testRuns/create`, {
      data: {
        data: {
          name: `E2E Test Run ${Date.now()}`,
          projectId: projectId,
          testRunType: "REGULAR",
        },
      },
    });

    expect(testRun.ok()).toBeTruthy();
    const testRunData = await testRun.json();
    const testRunId = testRunData.data.id;

    // Call the summary API endpoint
    const summaryResponse = await request.get(`/api/test-runs/${testRunId}/summary`);

    // Verify the API responds successfully (not hanging indefinitely)
    expect(summaryResponse.ok()).toBeTruthy();
    expect(summaryResponse.status()).toBe(200);

    // Verify the response has the expected structure
    const summary = await summaryResponse.json();
    expect(summary).toHaveProperty("testRunType");
    expect(summary).toHaveProperty("totalCases");
    expect(summary).toHaveProperty("statusCounts");
    expect(summary).toHaveProperty("completionRate");
  });

  test("multiple test run summary API calls succeed simultaneously", async ({ request, projectId }) => {
    // Create multiple test runs
    const testRunPromises = [1, 2, 3].map(i =>
      request.post(`/api/model/testRuns/create`, {
        data: {
          data: {
            name: `E2E Test Run ${Date.now()}-${i}`,
            projectId: projectId,
            testRunType: "REGULAR",
          },
        },
      })
    );

    const testRuns = await Promise.all(testRunPromises);
    const testRunIds = await Promise.all(
      testRuns.map(async (tr) => {
        const data = await tr.json();
        return data.data.id;
      })
    );

    // Call all summary APIs simultaneously
    const summaryPromises = testRunIds.map(id =>
      request.get(`/api/test-runs/${id}/summary`)
    );

    const summaries = await Promise.all(summaryPromises);

    // All should succeed without hanging
    summaries.forEach(summary => {
      expect(summary.ok()).toBeTruthy();
      expect(summary.status()).toBe(200);
    });
  });

  test("test run summary API handles missing test run", async ({ request }) => {
    // Call summary API for non-existent test run
    const summaryResponse = await request.get(`/api/test-runs/999999/summary`);

    // Should return 404, not hang
    expect(summaryResponse.status()).toBe(404);
  });
});
