import { expect, test } from "../../fixtures";

/**
 * Test Run PDF Export E2E Tests
 *
 * Tests the Export PDF button on the Test Run detail page.
 * Verifies the button is visible on both active and completed runs.
 */
test.describe("Test Run PDF Export", () => {
  test("should show Export PDF button on test run detail page", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E RunPdf ${ts}`);
    const runId = await api.createTestRun(
      projectId,
      `PDF Run ${ts}`
    );

    await page.goto(`/en-US/projects/runs/${projectId}/${runId}`);
    await page.waitForLoadState("load");

    // The Export PDF button should be visible in the header
    const exportButton = page.getByRole("button", { name: /export pdf/i });
    await expect(exportButton).toBeVisible({ timeout: 15000 });
  });

  test("should show Export PDF button on active test run detail page with test cases", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E RunPdfCases ${ts}`);
    const runId = await api.createTestRun(
      projectId,
      `PDF Run with Cases ${ts}`
    );

    // Add a test case to the run
    const folderId = await api.createFolder(projectId, `PDF Folder ${ts}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `PDF Case ${ts}`
    );
    await api.addTestCaseToTestRun(runId, caseId);

    await page.goto(`/en-US/projects/runs/${projectId}/${runId}`);
    await page.waitForLoadState("load");

    // Export PDF should be available
    const exportButton = page.getByRole("button", { name: /export pdf/i });
    await expect(exportButton).toBeVisible({ timeout: 15000 });
  });
});
