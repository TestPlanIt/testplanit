import { expect, test } from "../../fixtures";

/**
 * Session PDF Export E2E Tests
 *
 * Tests the Export PDF button on the Session detail page.
 * Verifies the button is visible and clickable. Actual PDF content
 * verification is handled by unit tests.
 */
test.describe("Session PDF Export", () => {
  test("should show Export PDF button on session detail page", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let projectId: number | undefined;
    let sessionId: number | undefined;

    await test.step("Create project and session via API", async () => {
      projectId = await api.createProject(`E2E SessPdf ${ts}`);
      sessionId = await api.createSession(projectId, `PDF Session ${ts}`);
    });

    await test.step("Open the session detail page and verify the Export PDF button is visible", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}/${sessionId}`);
      await page.waitForLoadState("load");

      // The Export PDF button should be visible in the header
      const exportButton = page.getByRole("button", { name: /export pdf/i });
      await expect(exportButton).toBeVisible({ timeout: 15000 });
    });

    // Cleanup
    await api.deleteSession(sessionId!);
  });

  test("should show Export PDF button on completed session detail page", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    let projectId: number | undefined;
    let sessionId: number | undefined;

    await test.step("Create project and completed session via API", async () => {
      projectId = await api.createProject(`E2E SessPdfDone ${ts}`);
      sessionId = await api.createSession(
        projectId,
        `Completed PDF Session ${ts}`,
        { isCompleted: true, completedAt: new Date() }
      );
    });

    await test.step("Open the completed session detail page and verify the Export PDF button is visible", async () => {
      await page.goto(`/en-US/projects/sessions/${projectId}/${sessionId}`);
      await page.waitForLoadState("load");

      // Export PDF should be available even on completed sessions
      const exportButton = page.getByRole("button", { name: /export pdf/i });
      await expect(exportButton).toBeVisible({ timeout: 15000 });
    });

    // Cleanup
    await api.deleteSession(sessionId!);
  });
});
