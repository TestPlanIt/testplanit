import { expect, test } from "../../../fixtures";
import { PromptConfigurationsPage } from "../../../page-objects/admin/prompt-configurations.page";

/**
 * Prompt LLM Selector E2E Tests
 *
 * Tests for selecting and clearing LLM integration overrides
 * on individual prompt features within the admin prompt editor dialog.
 *
 * Covers TEST-03: E2E coverage for admin prompt editor LLM selector workflow.
 */

const features = [
  "markdown_parsing",
  "test_case_generation",
  "magic_select_cases",
  "editor_assistant",
  "llm_test",
  "export_code_generation",
  "auto_tag",
  "duplicate_detection",
];

/**
 * Creates a prompt config with all features via the API.
 * Returns the config name.
 */
async function createPromptConfigViaApi(
  api: any,
  baseURL: string,
  configName: string
): Promise<void> {
  const response = await api["request"].post(
    `${baseURL}/api/model/promptConfig/create`,
    {
      data: {
        data: {
          name: configName,
          description: "Config for LLM selector E2E testing",
          isDefault: false,
          isActive: true,
          prompts: {
            create: features.map((feature) => ({
              feature,
              systemPrompt: `System prompt for ${feature}`,
              userPrompt: "",
              temperature: 0.7,
              maxOutputTokens: 2048,
            })),
          },
        },
      },
    }
  );

  if (!response.ok()) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create prompt config: ${response.status()} - ${errorText}`
    );
  }
}

test.describe("Prompt LLM Selector - Select Integration", () => {
  const configName = `E2E LLM Selector ${Date.now()}`;
  let promptsPage: PromptConfigurationsPage;

  test.beforeEach(async ({ page, api, baseURL }) => {
    promptsPage = new PromptConfigurationsPage(page);

    // Create a prompt config with all features via API
    const apiBase = baseURL || "http://localhost:3002";
    await createPromptConfigViaApi(api, apiBase, configName);

    await promptsPage.goto();
  });

  test("Select LLM integration for a prompt feature and save", async ({
    page,
    api,
  }) => {
    const llmName = `E2E LLM ${Date.now()}`;
    await api.createLlmIntegration(llmName);

    // Open the edit dialog
    await promptsPage.clickEditOnRow(configName);

    const dialog = page.locator('[role="dialog"]').first();

    // Expand the "Test Case Generation" accordion by clicking the trigger
    const accordionTrigger = dialog
      .locator('[data-orientation="vertical"] button')
      .filter({ hasText: "Test Case Generation" })
      .first();
    await accordionTrigger.scrollIntoViewIfNeeded();
    await accordionTrigger.click();

    // Wait for accordion to open
    await page.waitForTimeout(500);

    // Find the open accordion content
    const openAccordion = dialog.locator('[data-state="open"]').first();

    // Click the LLM Integration combobox (first combobox in the accordion)
    const llmSelectTrigger = openAccordion
      .locator('button[role="combobox"]')
      .first();
    await llmSelectTrigger.scrollIntoViewIfNeeded();
    await llmSelectTrigger.click();

    // Select the created integration from the dropdown
    const integrationOption = page.getByRole("option", { name: llmName });
    await integrationOption.click();

    // Save the form
    const saveButton = dialog.locator('button:has-text("Save")').last();
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    // Reload and verify the selection persisted
    await promptsPage.goto();
    await promptsPage.clickEditOnRow(configName);

    const dialog2 = page.locator('[role="dialog"]').first();

    // Expand the same accordion
    const accordionTrigger2 = dialog2
      .locator('[data-orientation="vertical"] button')
      .filter({ hasText: "Test Case Generation" })
      .first();
    await accordionTrigger2.scrollIntoViewIfNeeded();
    await accordionTrigger2.click();

    await page.waitForTimeout(1000);

    // Find the accordion item that contains "Test Case Generation" and is open
    const accordionItem2 = dialog2
      .locator('[data-orientation="vertical"] > div')
      .filter({ hasText: "Test Case Generation" })
      .first();
    const llmSelectText = accordionItem2
      .locator('button[role="combobox"]')
      .first();
    await expect(llmSelectText).toContainText(llmName, { timeout: 10000 });
  });
});

test.describe("Prompt LLM Selector - Clear Integration", () => {
  let promptsPage: PromptConfigurationsPage;

  test("Clear LLM integration returns to Project Default", async ({
    page,
    api,
    baseURL,
  }) => {
    const configName = `E2E LLM Clear ${Date.now()}`;
    const llmName = `E2E LLM Clear ${Date.now()}`;

    promptsPage = new PromptConfigurationsPage(page);

    const apiBase = baseURL || "http://localhost:3002";

    // Create LLM integration first
    const llmId = await api.createLlmIntegration(llmName);

    // Create a prompt config and set an LLM integration on one feature via API
    const createResponse = await api["request"].post(
      `${apiBase}/api/model/promptConfig/create`,
      {
        data: {
          data: {
            name: configName,
            description: "Config for clear LLM selector E2E testing",
            isDefault: false,
            isActive: true,
            prompts: {
              create: features.map((feature) => ({
                feature,
                systemPrompt: `System prompt for ${feature}`,
                userPrompt: "",
                temperature: 0.7,
                maxOutputTokens: 2048,
                // Set llmIntegrationId on "test_case_generation" feature
                ...(feature === "test_case_generation"
                  ? { llmIntegrationId: llmId }
                  : {}),
              })),
            },
          },
        },
      }
    );

    if (!createResponse.ok()) {
      const errorText = await createResponse.text();
      throw new Error(
        `Failed to create prompt config: ${createResponse.status()} - ${errorText}`
      );
    }

    await promptsPage.goto();

    // Open the edit dialog
    await promptsPage.clickEditOnRow(configName);

    const dialog = page.locator('[role="dialog"]').first();

    // Expand the "Test Case Generation" accordion
    const accordionTrigger = dialog
      .locator('[data-orientation="vertical"] button')
      .filter({ hasText: "Test Case Generation" })
      .first();
    await accordionTrigger.scrollIntoViewIfNeeded();
    await accordionTrigger.click();

    await page.waitForTimeout(500);

    const openAccordion = dialog.locator('[data-state="open"]').first();

    // Verify integration is currently selected (shows llmName)
    const llmSelectTrigger = openAccordion
      .locator('button[role="combobox"]')
      .first();
    await expect(llmSelectTrigger).toContainText(llmName);

    // Click the LLM Integration combobox to open the dropdown
    await llmSelectTrigger.click();

    // Select "Project Default (clear)" to clear the integration
    // The __clear__ sentinel renders as "Project Default (clear)" per the en-US translation
    const projectDefaultOption = page.getByRole("option", {
      name: "Project Default (clear)",
    });
    await projectDefaultOption.click();

    // Save the form
    const saveButton = dialog.locator('button:has-text("Save")').last();
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();

    // Wait for dialog to close
    await expect(dialog).not.toBeVisible({ timeout: 30000 });

    // Reload and verify the selection was cleared (shows placeholder, not integration name)
    await promptsPage.goto();
    await promptsPage.clickEditOnRow(configName);

    const dialog2 = page.locator('[role="dialog"]').first();

    const accordionTrigger2 = dialog2
      .locator('[data-orientation="vertical"] button')
      .filter({ hasText: "Test Case Generation" })
      .first();
    await accordionTrigger2.scrollIntoViewIfNeeded();
    await accordionTrigger2.click();

    await page.waitForTimeout(1000);

    // Find the accordion item that contains "Test Case Generation"
    const accordionItem2 = dialog2
      .locator('[data-orientation="vertical"] > div')
      .filter({ hasText: "Test Case Generation" })
      .first();
    const llmSelectText2 = accordionItem2
      .locator('button[role="combobox"]')
      .first();

    // Should not contain the LLM name (it's been cleared)
    await expect(llmSelectText2).not.toContainText(llmName, { timeout: 10000 });
  });
});
