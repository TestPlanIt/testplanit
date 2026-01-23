import { test, expect } from "../../fixtures";

/**
 * Test Run Summary API Tests
 *
 * These tests verify that the test run summary API endpoints work correctly
 * and don't cause infinite skeleton loading due to database connection issues.
 *
 * The bug being tested: API routes were creating new PrismaClient instances
 * which exhausted the connection pool in dev mode, causing requests to hang.
 *
 * These tests use seeded data from seedTestData.ts for predictable, comprehensive testing.
 */
test.describe("Test Run Summary API", () => {
  test("test run summary API responds successfully with seeded data", async ({
    request,
  }) => {
    // Find the E2E Test Project
    const projectResponse = await request.get(
      `/api/model/projects/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: { name: "E2E Test Project" },
        })
      )}`
    );
    expect(projectResponse.ok()).toBeTruthy();
    const project = await projectResponse.json();

    // Find a test run with results (Smoke Test)
    const testRunResponse = await request.get(
      `/api/model/testRuns/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: {
            projectId: project.data.id,
            name: "Smoke Test - Build 1.2.3",
          },
        })
      )}`
    );
    expect(testRunResponse.ok()).toBeTruthy();
    const testRun = await testRunResponse.json();
    const testRunId = testRun.data.id;

    // Call the summary API endpoint
    const summaryResponse = await request.get(
      `/api/test-runs/${testRunId}/summary`
    );

    // Verify the API responds successfully (not hanging indefinitely)
    expect(summaryResponse.ok()).toBeTruthy();
    expect(summaryResponse.status()).toBe(200);

    // Verify the response has the expected structure
    const summary = await summaryResponse.json();
    expect(summary).toHaveProperty("testRunType");
    expect(summary).toHaveProperty("totalCases");
    expect(summary).toHaveProperty("statusCounts");
    expect(summary).toHaveProperty("completionRate");

    // Verify actual data matches seeded test run (3 passed, 1 failed, 1 untested)
    expect(summary.totalCases).toBe(5);
    expect(summary.completionRate).toBe(80); // 4 out of 5
  });

  test("multiple test run summary API calls succeed simultaneously", async ({
    request,
  }) => {
    // Find the E2E Test Project
    const projectResponse = await request.get(
      `/api/model/projects/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: { name: "E2E Test Project" },
        })
      )}`
    );
    const project = await projectResponse.json();

    // Find all test runs for the project
    const testRunsResponse = await request.get(
      `/api/model/testRuns/findMany?q=${encodeURIComponent(
        JSON.stringify({
          where: {
            projectId: project.data.id,
            name: {
              in: [
                "Smoke Test - Build 1.2.3",
                "Regression Suite - Automated",
                "Sprint 5 Acceptance Tests",
              ],
            },
          },
          select: { id: true },
        })
      )}`
    );
    const testRuns = await testRunsResponse.json();
    const testRunIds = testRuns.data.map((tr: { id: number }) => tr.id);

    // Call all summary APIs simultaneously
    const summaryPromises = testRunIds.map((id: number) =>
      request.get(`/api/test-runs/${id}/summary`)
    );

    const summaries = await Promise.all(summaryPromises);

    // All should succeed without hanging
    summaries.forEach((summary) => {
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

  test("test run summary API returns correct data for empty test run", async ({
    request,
  }) => {
    // Find the E2E Test Project
    const projectResponse = await request.get(
      `/api/model/projects/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: { name: "E2E Test Project" },
        })
      )}`
    );
    const project = await projectResponse.json();

    // Find the empty test run
    const testRunResponse = await request.get(
      `/api/model/testRuns/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: {
            projectId: project.data.id,
            name: "Empty Test Run",
          },
        })
      )}`
    );
    expect(testRunResponse.ok()).toBeTruthy();
    const testRun = await testRunResponse.json();

    // Get summary
    const summaryResponse = await request.get(
      `/api/test-runs/${testRun.data.id}/summary`
    );
    expect(summaryResponse.ok()).toBeTruthy();

    const summary = await summaryResponse.json();
    expect(summary.totalCases).toBe(0);
    expect(summary.completionRate).toBe(0);
  });

  test("test run summary API returns correct data for automated test run", async ({
    request,
  }) => {
    // Find the E2E Test Project
    const projectResponse = await request.get(
      `/api/model/projects/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: { name: "E2E Test Project" },
        })
      )}`
    );
    const project = await projectResponse.json();

    // Find the automated test run
    const testRunResponse = await request.get(
      `/api/model/testRuns/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: {
            projectId: project.data.id,
            name: "Regression Suite - Automated",
          },
        })
      )}`
    );
    expect(testRunResponse.ok()).toBeTruthy();
    const testRun = await testRunResponse.json();

    // Get summary
    const summaryResponse = await request.get(
      `/api/test-runs/${testRun.data.id}/summary`
    );
    expect(summaryResponse.ok()).toBeTruthy();

    const summary = await summaryResponse.json();
    expect(summary.testRunType).toBe("REGULAR");
    expect(summary.totalCases).toBe(3);
    expect(summary.completionRate).toBe(100); // All 3 passed
  });
});
