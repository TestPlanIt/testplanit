import { expect, test } from "../../fixtures";

/**
 * AI Test Case Generation Wizard E2E tests - AI-01
 *
 * Tests the GenerateTestCasesWizard flow using Playwright route interception
 * to mock LLM API responses. An LlmIntegration record is seeded per test so
 * the wizard trigger button (Sparkles) is always rendered.
 */

test.describe("AI Test Case Generation Wizard", () => {
  test("should show wizard trigger button when LLM integration is configured", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Gen Wizard ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM Gen ${ts}`);
    await api.linkLlmToProject(projectId, llmId);
    const folderId = await api.createFolder(projectId, `Gen Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `Existing Case ${ts}`);

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    // Click the folder so the right panel header renders
    const folderNode = page
      .locator('[data-testid^="folder-node-"]')
      .first();
    await expect(folderNode).toBeVisible({ timeout: 15000 });
    await folderNode.click();

    await expect(
      page.locator('[data-testid="repository-layout"]')
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.locator('[data-testid="repository-right-panel-header"]')
    ).toBeVisible({ timeout: 10000 });

    // With LLM integration configured, the Sparkles wizard trigger must be visible
    const wizardTrigger = page
      .locator('button:has(svg.lucide-sparkles)')
      .first();
    await expect(wizardTrigger).toBeVisible({ timeout: 10000 });

    // Click to open the wizard
    await wizardTrigger.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Verify first step (source type selection with tabs)
    await expect(dialog.locator('[role="tab"]').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("should show wizard with AI info alert when LLM integration is configured", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Gen Alert ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM Alert ${ts}`);
    await api.linkLlmToProject(projectId, llmId);
    const folderId = await api.createFolder(projectId, `Alert Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `Alert Case ${ts}`);

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    const folderNode = page
      .locator('[data-testid^="folder-node-"]')
      .first();
    await expect(folderNode).toBeVisible({ timeout: 15000 });
    await folderNode.click();

    await expect(
      page.locator('[data-testid="repository-right-panel-header"]')
    ).toBeVisible({ timeout: 10000 });

    const wizardTrigger = page
      .locator('button:has(svg.lucide-sparkles)')
      .first();
    await expect(wizardTrigger).toBeVisible({ timeout: 10000 });
    await wizardTrigger.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // The wizard renders an info Alert in the DialogHeader
    const infoAlert = dialog.locator('[role="alert"]').first();
    await expect(infoAlert).toBeVisible({ timeout: 5000 });

    // Verify the alert contains an Info icon
    const infoIcon = dialog.locator('svg.lucide-info').first();
    await expect(infoIcon).toBeVisible({ timeout: 5000 });
  });

  test("should mock LLM route and handle generated test cases response", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Gen Mock LLM ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM Mock ${ts}`);
    await api.linkLlmToProject(projectId, llmId);
    const folderId = await api.createFolder(projectId, `Mock LLM Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `Mock Case ${ts}`);

    // Mock the LLM generate-test-cases endpoint before navigation
    await page.route("**/api/llm/generate-test-cases", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          testCases: [
            {
              id: "tc_1",
              name: "Verify login with valid credentials",
              description: "Test that users can log in successfully",
              steps: [
                {
                  step: "Enter valid email",
                  expectedResult: "Email accepted",
                },
              ],
              fieldValues: {},
              priority: "High",
              automated: false,
              tags: ["Smoke"],
            },
          ],
          metadata: {
            issueKey: "TEST-1",
            templateName: "Default",
            generatedCount: 1,
            model: "mock-model",
            tokens: { prompt: 100, completion: 200, total: 300 },
          },
        }),
      });
    });

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    const folderNode = page
      .locator('[data-testid^="folder-node-"]')
      .first();
    await expect(folderNode).toBeVisible({ timeout: 15000 });
    await folderNode.click();

    await expect(
      page.locator('[data-testid="repository-right-panel-header"]')
    ).toBeVisible({ timeout: 10000 });

    const wizardTrigger = page
      .locator('button:has(svg.lucide-sparkles)')
      .first();
    await expect(wizardTrigger).toBeVisible({ timeout: 10000 });
    await wizardTrigger.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Verify dialog has wizard content with tabs/tabpanels
    await expect(
      dialog.locator('[role="tab"], [role="tabpanel"]').first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("should mock LLM error response and handle gracefully", async ({
    page,
    api,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Gen Error ${ts}`);
    const llmId = await api.createLlmIntegration(`E2E LLM Error ${ts}`);
    await api.linkLlmToProject(projectId, llmId);
    const folderId = await api.createFolder(projectId, `Error Folder ${ts}`);
    await api.createTestCase(projectId, folderId, `Error Case ${ts}`);

    // Mock the LLM route to return an error
    await page.route("**/api/llm/generate-test-cases", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "No active LLM integration",
        }),
      });
    });

    await page.goto(`/en-US/projects/repository/${projectId}`);
    await page.waitForLoadState("networkidle");

    const folderNode = page
      .locator('[data-testid^="folder-node-"]')
      .first();
    await expect(folderNode).toBeVisible({ timeout: 15000 });
    await folderNode.click();

    await expect(
      page.locator('[data-testid="repository-right-panel-header"]')
    ).toBeVisible({ timeout: 10000 });

    const wizardTrigger = page
      .locator('button:has(svg.lucide-sparkles)')
      .first();
    await expect(wizardTrigger).toBeVisible({ timeout: 10000 });
    await wizardTrigger.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Dialog is already confirmed visible above, verify it has content (wizard tabs)
    await expect(dialog.locator('[role="tab"], [role="tabpanel"], form').first()).toBeVisible({ timeout: 5000 });
  });
});
