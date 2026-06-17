import { expect, test } from "../../fixtures";

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
    let project: any;
    let sessionId: number | undefined;
    let summaryResponse: Awaited<ReturnType<typeof request.get>> | undefined;
    let summary: any;

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

    await test.step("Find the Exploratory Testing session with results", async () => {
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
      sessionId = session.data.id;
    });

    await test.step("Call the summary API and verify a successful 200 response", async () => {
      // Call the summary API endpoint
      summaryResponse = await request.get(`/api/sessions/${sessionId}/summary`);

      // Verify the API responds successfully (not hanging indefinitely)
      expect(summaryResponse.ok()).toBeTruthy();
      expect(summaryResponse.status()).toBe(200);
    });

    await test.step("Verify the summary response structure and seeded data", async () => {
      // Verify the response has the expected structure
      summary = await summaryResponse!.json();
      expect(summary).toHaveProperty("sessionId");
      expect(summary).toHaveProperty("totalElapsed");
      expect(summary).toHaveProperty("results");
      expect(summary).toHaveProperty("commentsCount");

      // Verify actual data matches seeded session (5 results: 3 passed, 2 failed)
      expect(summary.results).toHaveLength(5);
      // totalElapsed is sum of result elapsed times: 600+720+480+540+660 = 3000
      expect(summary.totalElapsed).toBe(3000);
    });
  });

  test("multiple session summary API calls succeed simultaneously", async ({
    request,
  }) => {
    let project: any;
    let sessionIds: number[] | undefined;
    let summaries: Awaited<ReturnType<typeof request.get>>[] | undefined;

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

    await test.step("Find all sessions for the project", async () => {
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
      sessionIds = sessions.data.map((s: { id: number }) => s.id);
    });

    await test.step("Call all summary APIs simultaneously", async () => {
      const summaryPromises = sessionIds!.map((id: number) =>
        request.get(`/api/sessions/${id}/summary`)
      );

      summaries = await Promise.all(summaryPromises);
    });

    await test.step("Verify every summary call succeeds without hanging", async () => {
      summaries!.forEach((summary) => {
        expect(summary.ok()).toBeTruthy();
        expect(summary.status()).toBe(200);
      });
    });
  });

  test("session summary API handles missing session", async ({ request }) => {
    // Call summary API for non-existent session
    const summaryResponse = await request.get(`/api/sessions/999999/summary`);

    // Should return 404, not hang
    expect(summaryResponse.status()).toBe(404);
  });

  test("session summary API returns empty results for new session", async ({
    request,
  }) => {
    let project: any;
    let session: any;

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

    await test.step("Find the empty session", async () => {
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
      session = await sessionResponse.json();
    });

    await test.step("Get summary and verify empty results", async () => {
      const summaryResponse = await request.get(
        `/api/sessions/${session.data.id}/summary`
      );
      expect(summaryResponse.ok()).toBeTruthy();

      const summary = await summaryResponse.json();
      expect(summary.results).toEqual([]);
      expect(summary.totalElapsed).toBe(0);
      expect(summary.commentsCount).toBe(0);
    });
  });
});

test.describe("Sort toggle – statusOrder field", () => {
  test("session summary includes statusOrder in every result", async ({
    request,
  }) => {
    const projectResponse = await request.get(
      `/api/model/projects/findFirst?q=${encodeURIComponent(
        JSON.stringify({ where: { name: "E2E Test Project" } })
      )}`
    );
    const project = await projectResponse.json();

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
    const session = await sessionResponse.json();

    const summaryResponse = await request.get(
      `/api/sessions/${session.data.id}/summary`
    );
    expect(summaryResponse.ok()).toBeTruthy();

    const summary = await summaryResponse.json();
    expect(summary.results.length).toBeGreaterThan(0);

    for (const result of summary.results) {
      expect(result).toHaveProperty("statusOrder");
      expect(typeof result.statusOrder).toBe("number");
    }
  });
});
