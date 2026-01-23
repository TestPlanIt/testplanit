import { test, expect } from "../../fixtures";

/**
 * Session Summary API Tests
 *
 * These tests verify that the session summary API endpoints work correctly
 * and don't cause infinite skeleton loading due to database connection issues.
 *
 * The bug being tested: API routes were creating new PrismaClient instances
 * which exhausted the connection pool in dev mode, causing requests to hang.
 */
test.describe("Session Summary API", () => {
  test("session summary API responds successfully", async ({ request, projectId }) => {
    // Create a session using the API
    const session = await request.post(`/api/model/sessions/create`, {
      data: {
        data: {
          name: `E2E Test Session ${Date.now()}`,
          projectId: projectId,
        },
      },
    });

    expect(session.ok()).toBeTruthy();
    const sessionData = await session.json();
    const sessionId = sessionData.data.id;

    // Call the summary API endpoint
    const summaryResponse = await request.get(`/api/sessions/${sessionId}/summary`);

    // Verify the API responds successfully (not hanging indefinitely)
    expect(summaryResponse.ok()).toBeTruthy();
    expect(summaryResponse.status()).toBe(200);

    // Verify the response has the expected structure
    const summary = await summaryResponse.json();
    expect(summary).toHaveProperty("sessionId");
    expect(summary).toHaveProperty("totalElapsed");
    expect(summary).toHaveProperty("results");
    expect(summary).toHaveProperty("commentsCount");
  });

  test("multiple session summary API calls succeed simultaneously", async ({ request, projectId }) => {
    // Create multiple sessions
    const sessionPromises = [1, 2, 3].map(i =>
      request.post(`/api/model/sessions/create`, {
        data: {
          data: {
            name: `E2E Test Session ${Date.now()}-${i}`,
            projectId: projectId,
          },
        },
      })
    );

    const sessions = await Promise.all(sessionPromises);
    const sessionIds = await Promise.all(
      sessions.map(async (s) => {
        const data = await s.json();
        return data.data.id;
      })
    );

    // Call all summary APIs simultaneously
    const summaryPromises = sessionIds.map(id =>
      request.get(`/api/sessions/${id}/summary`)
    );

    const summaries = await Promise.all(summaryPromises);

    // All should succeed without hanging
    summaries.forEach(summary => {
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

  test("session summary API returns empty results for new session", async ({ request, projectId }) => {
    // Create a new session with no results
    const session = await request.post(`/api/model/sessions/create`, {
      data: {
        data: {
          name: `E2E Empty Session ${Date.now()}`,
          projectId: projectId,
        },
      },
    });

    const sessionData = await session.json();
    const sessionId = sessionData.data.id;

    // Get summary
    const summaryResponse = await request.get(`/api/sessions/${sessionId}/summary`);
    expect(summaryResponse.ok()).toBeTruthy();

    const summary = await summaryResponse.json();
    expect(summary.results).toEqual([]);
    expect(summary.totalElapsed).toBe(0);
    expect(summary.commentsCount).toBe(0);
  });
});
