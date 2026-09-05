import { expect, test } from "../../fixtures";
import type { APIResponse } from "@playwright/test";

/**
 * Test Run Summary API Tests
 *
 * These tests verify that the test run summary API endpoints work correctly
 * and don't cause infinite skeleton loading due to database connection issues.
 *
 * The bug being tested: API routes were creating new ReturnType<typeof createRawDbClient> instances
 * which exhausted the connection pool in dev mode, causing requests to hang.
 *
 * These tests use seeded data from seedTestData.ts for predictable, comprehensive testing.
 */
test.describe("Test Run Summary API", () => {
  test("test run summary API responds successfully with seeded data", async ({
    request,
  }) => {
    let project: any;
    let testRunId: number | undefined;
    let summaryResponse: APIResponse | undefined;

    await test.step("Find the E2E Test Project", async () => {
      const projectResponse = await request.get(
        `/api/model/projects/findFirst?q=${encodeURIComponent(
          JSON.stringify({
            where: { name: "E2E Test Project" },
          })
        )}`
      );
      expect(projectResponse.ok()).toBeTruthy();
      project = await projectResponse.json();
    });

    await test.step("Find a test run with results (Smoke Test)", async () => {
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
      testRunId = testRun.data.id;
    });

    await test.step("Call the summary API endpoint", async () => {
      summaryResponse = await request.get(
        `/api/test-runs/${testRunId}/summary`
      );
    });

    await test.step("Verify the API responds successfully and returns expected summary data", async () => {
      // Verify the API responds successfully (not hanging indefinitely)
      expect(summaryResponse!.ok()).toBeTruthy();
      expect(summaryResponse!.status()).toBe(200);

      // Verify the response has the expected structure
      const summary = await summaryResponse!.json();
      expect(summary).toHaveProperty("testRunType");
      expect(summary).toHaveProperty("totalCases");
      expect(summary).toHaveProperty("statusCounts");
      expect(summary).toHaveProperty("completionRate");

      // Verify actual data matches seeded test run (3 passed, 1 failed, 1 untested)
      expect(summary.totalCases).toBe(5);
      expect(summary.completionRate).toBe(80); // 4 out of 5
    });
  });

  test("multiple test run summary API calls succeed simultaneously", async ({
    request,
  }) => {
    let project: any;
    let testRunIds: number[] | undefined;

    await test.step("Find the E2E Test Project", async () => {
      const projectResponse = await request.get(
        `/api/model/projects/findFirst?q=${encodeURIComponent(
          JSON.stringify({
            where: { name: "E2E Test Project" },
          })
        )}`
      );
      project = await projectResponse.json();
    });

    await test.step("Find all test runs for the project", async () => {
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
      testRunIds = testRuns.data.map((tr: { id: number }) => tr.id);
    });

    await test.step("Call all summary APIs simultaneously and verify all succeed", async () => {
      // Call all summary APIs simultaneously
      const summaryPromises = testRunIds!.map((id: number) =>
        request.get(`/api/test-runs/${id}/summary`)
      );

      const summaries = await Promise.all(summaryPromises);

      // All should succeed without hanging
      summaries.forEach((summary) => {
        expect(summary.ok()).toBeTruthy();
        expect(summary.status()).toBe(200);
      });
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
    let project: any;
    let testRun: any;

    await test.step("Find the E2E Test Project", async () => {
      const projectResponse = await request.get(
        `/api/model/projects/findFirst?q=${encodeURIComponent(
          JSON.stringify({
            where: { name: "E2E Test Project" },
          })
        )}`
      );
      project = await projectResponse.json();
    });

    await test.step("Find the empty test run", async () => {
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
      testRun = await testRunResponse.json();
    });

    await test.step("Get summary and verify zero cases", async () => {
      const summaryResponse = await request.get(
        `/api/test-runs/${testRun.data.id}/summary`
      );
      expect(summaryResponse.ok()).toBeTruthy();

      const summary = await summaryResponse.json();
      expect(summary.totalCases).toBe(0);
      expect(summary.completionRate).toBe(0);
    });
  });

  test("test run summary API returns correct data for automated test run", async ({
    request,
  }) => {
    let project: any;
    let testRun: any;

    await test.step("Find the E2E Test Project", async () => {
      const projectResponse = await request.get(
        `/api/model/projects/findFirst?q=${encodeURIComponent(
          JSON.stringify({
            where: { name: "E2E Test Project" },
          })
        )}`
      );
      project = await projectResponse.json();
    });

    await test.step("Find the automated test run", async () => {
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
      testRun = await testRunResponse.json();
    });

    await test.step("Get summary and verify automated run totals", async () => {
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
});

test.describe("Sort toggle – statusOrder field", () => {
  test("single-run summary includes statusOrder in every caseDetail", async ({
    request,
  }) => {
    let project: any;
    let testRun: any;

    await test.step("Find the E2E Test Project and Smoke Test run", async () => {
      const projectResponse = await request.get(
        `/api/model/projects/findFirst?q=${encodeURIComponent(
          JSON.stringify({ where: { name: "E2E Test Project" } })
        )}`
      );
      project = await projectResponse.json();
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
      testRun = await testRunResponse.json();
    });

    await test.step("Fetch summary with case details and verify statusOrder on each", async () => {
      const summaryResponse = await request.get(
        `/api/test-runs/${testRun.data.id}/summary?includeCaseDetails=true`
      );
      expect(summaryResponse.ok()).toBeTruthy();

      const summary = await summaryResponse.json();
      expect(Array.isArray(summary.caseDetails)).toBe(true);
      expect(summary.caseDetails.length).toBeGreaterThan(0);

      for (const detail of summary.caseDetails) {
        expect(detail).toHaveProperty("statusOrder");
        expect(
          detail.statusOrder === null || typeof detail.statusOrder === "number"
        ).toBe(true);
      }
    });
  });

  test("batch summaries endpoint includes statusOrder in every caseDetail", async ({
    request,
  }) => {
    let project: any;
    let ids: number[] | undefined;

    await test.step("Find the E2E Test Project", async () => {
      const projectResponse = await request.get(
        `/api/model/projects/findFirst?q=${encodeURIComponent(
          JSON.stringify({ where: { name: "E2E Test Project" } })
        )}`
      );
      project = await projectResponse.json();
    });

    await test.step("Collect IDs for the target test runs", async () => {
      const runsResponse = await request.get(
        `/api/model/testRuns/findMany?q=${encodeURIComponent(
          JSON.stringify({
            where: {
              projectId: project.data.id,
              name: {
                in: ["Smoke Test - Build 1.2.3", "Sprint 5 Acceptance Tests"],
              },
            },
            select: { id: true },
          })
        )}`
      );
      const runs = await runsResponse.json();
      ids = runs.data.map((r: { id: number }) => r.id);
      expect(ids!.length).toBeGreaterThan(0);
    });

    await test.step("Fetch batch summaries and verify statusOrder on each caseDetail", async () => {
      const batchResponse = await request.get(
        `/api/test-runs/summaries?testRunIds=${ids!.join(",")}`
      );
      expect(batchResponse.ok()).toBeTruthy();

      const batch = await batchResponse.json();
      const summaries = Object.values(batch.summaries) as Array<{
        caseDetails?: Array<{ statusOrder: number | null }>;
      }>;
      expect(summaries.length).toBeGreaterThan(0);

      for (const summary of summaries) {
        if (!summary.caseDetails?.length) continue;
        for (const detail of summary.caseDetails) {
          expect(detail).toHaveProperty("statusOrder");
          expect(
            detail.statusOrder === null ||
              typeof detail.statusOrder === "number"
          ).toBe(true);
        }
      }
    });
  });
});
