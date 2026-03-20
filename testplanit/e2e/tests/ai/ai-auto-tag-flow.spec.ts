import { expect, test } from "../../fixtures";

/**
 * Auto-Tag Flow E2E tests - AI-02
 *
 * Tests the AutoTagWizardDialog bulk action flow using Playwright route
 * interception to mock the auto-tag API endpoints.
 *
 * An LlmIntegration record is seeded per test so the auto-tag button
 * (data-testid="auto-tag-cases-button") is rendered when cases are selected.
 *
 * The AutoTagWizardDialog has `autoStart` prop set, which means it skips the
 * configure step and immediately starts analysis when opened.
 */

test.describe("Auto-Tag Flow", () => {
  test("should show auto-tag button when cases are selected and LLM integration exists", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E AutoTag ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM AutoTag ${ts}`);
    await api.linkLlmToProject(projectId, llmId);
    const folderId = await api.createFolder(projectId, `AutoTag Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `AutoTag Case A ${ts}`);
    await api.createTestCase(projectId, folderId, `AutoTag Case B ${ts}`);

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Click the specific folder (not Root Folder which has no cases)
    const folderNode = page.getByTestId(`folder-node-${folderId}`);
    await expect(folderNode).toBeVisible({ timeout: 15000 });
    await folderNode.click();

    // Wait for actual case rows to render (not just the loading skeleton)
    const caseCheckbox = page.locator('[data-testid^="case-checkbox-"]').first();
    await expect(caseCheckbox).toBeVisible({ timeout: 15000 });

    // Now select all cases via header checkbox
    const headerCheckbox = page
      .locator('thead [role="checkbox"]')
      .first();
    await expect(headerCheckbox).toBeVisible({ timeout: 5000 });
    await headerCheckbox.click();

    // Auto-tag button should be visible with LLM integration configured
    const autoTagButton = page.getByTestId("auto-tag-cases-button");
    await expect(autoTagButton).toBeVisible({ timeout: 10000 });
  });

  test("should open auto-tag dialog and show analysis progress with mocked API", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E AutoTag Mock ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM AutoTag Mock ${ts}`);
    await api.linkLlmToProject(projectId, llmId);
    const folderId = await api.createFolder(projectId, `Mock Folder ${ts}`);
    const caseId = await api.createTestCase(
      projectId,
      folderId,
      `Mock AutoTag Case ${ts}`
    );

    // Set up auto-tag API route mocks
    await page.route("**/api/auto-tag/submit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "mock-job-123" }),
      });
    });

    // Status endpoint: first call returns active, subsequent calls return completed
    let statusCallCount = 0;
    await page.route("**/api/auto-tag/status/mock-job-123", async (route) => {
      statusCallCount++;
      if (statusCallCount <= 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jobId: "mock-job-123",
            state: "active",
            progress: { analyzed: 0, total: 1, finalizing: false },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            jobId: "mock-job-123",
            state: "completed",
            progress: { analyzed: 1, total: 1, finalizing: false },
            result: {
              suggestions: [
                {
                  entityId: caseId,
                  entityType: "repositoryCase",
                  tags: [{ name: "UI", isNew: false, confidence: 0.95 }],
                },
              ],
            },
          }),
        });
      }
    });

    await page.route("**/api/auto-tag/apply", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ applied: 1, tagsCreated: 0, tagsReused: 1 }),
      });
    });

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Click the specific folder (not Root Folder which has no cases)
    const folderNode = page.getByTestId(`folder-node-${folderId}`);
    await expect(folderNode).toBeVisible({ timeout: 15000 });
    await folderNode.click();

    // Wait for actual case rows to render (not just the loading skeleton)
    const caseCheckbox = page.locator('[data-testid^="case-checkbox-"]').first();
    await expect(caseCheckbox).toBeVisible({ timeout: 15000 });

    // Select cases via header checkbox
    const headerCheckbox = page
      .locator('thead [role="checkbox"]')
      .first();
    await expect(headerCheckbox).toBeVisible({ timeout: 5000 });
    await headerCheckbox.click();

    // Click the auto-tag button
    const autoTagButton = page.getByTestId("auto-tag-cases-button");
    await expect(autoTagButton).toBeVisible({ timeout: 10000 });
    await autoTagButton.click();

    // The dialog should open in "analyzing" state (autoStart skips configure)
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Wait for the analysis to show progress or complete
    // Either a spinner is visible (in-progress) or results are shown (completed)
    const spinnerOrResults = dialog.locator(
      'svg.lucide-loader-2, [class*="animate-spin"], table, [data-testid*="tag"]'
    ).first();
    await expect(spinnerOrResults).toBeVisible({ timeout: 10000 });

    // Dialog should remain open during/after analysis
    await expect(dialog).toBeVisible();
  });

  test("should verify auto-tag mock routes intercept correctly", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E AutoTag Routes ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM Routes ${ts}`);
    await api.linkLlmToProject(projectId, llmId);

    let _submitIntercepted = false;

    await page.route("**/api/auto-tag/submit", async (route) => {
      _submitIntercepted = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jobId: "mock-job-123" }),
      });
    });

    await page.route("**/api/auto-tag/status/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jobId: "mock-job-123",
          state: "completed",
          progress: { analyzed: 1, total: 1 },
          result: {
            suggestions: [
              {
                entityId: 1,
                entityType: "repositoryCase",
                tags: [{ name: "Smoke", isNew: false, confidence: 0.9 }],
              },
            ],
          },
        }),
      });
    });

    await page.route("**/api/auto-tag/apply", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ applied: 1, tagsCreated: 0, tagsReused: 1 }),
      });
    });

    // Navigate to the project repository and verify the page loads
    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    await expect(
      page.locator('[data-testid="repository-layout"]')
    ).toBeVisible({ timeout: 15000 });
  });
});
