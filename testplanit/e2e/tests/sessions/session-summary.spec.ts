import { test, expect } from "../../fixtures";

/**
 * Session Summary API Tests
 *
 * These tests verify that the session summary API endpoints work correctly
 * and don't cause infinite skeleton loading due to database connection issues.
 *
 * The bug being tested: API routes were creating new PrismaClient instances
 * which exhausted the connection pool in dev mode, causing requests to hang.
 *
 * These tests use seeded data from seedTestData.ts for predictable, comprehensive testing.
 */
test.describe("Session Summary API", () => {
  test("session summary API responds successfully with seeded data", async ({
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

    // Find a session with results (Exploratory Testing)
    const sessionResponse = await request.get(
      `/api/model/sessions/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: {
            projectId: project.data.id,
            name: "Exploratory Testing - User Management",
          },
        })
      )}`
    );
    expect(sessionResponse.ok()).toBeTruthy();
    const session = await sessionResponse.json();
    const sessionId = session.data.id;

    // Call the summary API endpoint
    const summaryResponse = await request.get(
      `/api/sessions/${sessionId}/summary`
    );

    // Verify the API responds successfully (not hanging indefinitely)
    expect(summaryResponse.ok()).toBeTruthy();
    expect(summaryResponse.status()).toBe(200);

    // Verify the response has the expected structure
    const summary = await summaryResponse.json();
    expect(summary).toHaveProperty("sessionId");
    expect(summary).toHaveProperty("totalElapsed");
    expect(summary).toHaveProperty("results");
    expect(summary).toHaveProperty("commentsCount");

    // Verify actual data matches seeded session (5 results: 3 passed, 2 failed)
    expect(summary.results).toHaveLength(5);
    // totalElapsed is sum of result elapsed times: 600+720+480+540+660 = 3000
    expect(summary.totalElapsed).toBe(3000);
  });

  test("multiple session summary API calls succeed simultaneously", async ({ request }) => {
    // Find the E2E Test Project
    const projectResponse = await request.get(
      `/api/model/projects/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: { name: "E2E Test Project" },
        })
      )}`
    );
    const project = await projectResponse.json();

    // Find all sessions for the project
    const sessionsResponse = await request.get(
      `/api/model/sessions/findMany?q=${encodeURIComponent(
        JSON.stringify({
          where: {
            projectId: project.data.id,
            name: {
              in: [
                "Exploratory Testing - User Management",
                "Security Testing - Authentication",
                "Performance Testing - Dashboard Load",
              ],
            },
          },
          select: { id: true },
        })
      )}`
    );
    const sessions = await sessionsResponse.json();
    const sessionIds = sessions.data.map((s: { id: number }) => s.id);

    // Call all summary APIs simultaneously
    const summaryPromises = sessionIds.map((id: number) =>
      request.get(`/api/sessions/${id}/summary`)
    );

    const summaries = await Promise.all(summaryPromises);

    // All should succeed without hanging
    summaries.forEach((summary) => {
      expect(summary.ok()).toBeTruthy();
      expect(summary.status()).toBe(200);
    });
  });

  test("session summary API handles missing session", async ({ request }) => {
    // Call summary API for non-existent session
    const summaryResponse = await request.get(`/api/sessions/999999/summary`);

    // Should return 404, not hang
    expect(summaryResponse.status()).toBe(404);
  });

  test("session summary API returns empty results for new session", async ({ request }) => {
    // Find the E2E Test Project
    const projectResponse = await request.get(
      `/api/model/projects/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: { name: "E2E Test Project" },
        })
      )}`
    );
    const project = await projectResponse.json();

    // Find the empty session
    const sessionResponse = await request.get(
      `/api/model/sessions/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: {
            projectId: project.data.id,
            name: "Empty Session",
          },
        })
      )}`
    );
    expect(sessionResponse.ok()).toBeTruthy();
    const session = await sessionResponse.json();

    // Get summary
    const summaryResponse = await request.get(`/api/sessions/${session.data.id}/summary`);
    expect(summaryResponse.ok()).toBeTruthy();

    const summary = await summaryResponse.json();
    expect(summary.results).toEqual([]);
    expect(summary.totalElapsed).toBe(0);
    expect(summary.commentsCount).toBe(0);
  });
});
