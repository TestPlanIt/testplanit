import { expect, test } from "../../../fixtures";
import { PromptConfigurationsPage } from "../../../page-objects/admin/prompt-configurations.page";

/**
 * Prompt Configurations CRUD Operations Tests
 *
 * Tests for navigating, creating, editing, filtering, and deleting
 * prompt configurations in the Admin > Prompt Configurations page.
 */

test.describe("Prompt Configurations - Navigation and Display", () => {
  let promptsPage: PromptConfigurationsPage;

  test.beforeEach(async ({ page }) => {
    promptsPage = new PromptConfigurationsPage(page);
  });

  test("Navigate to Prompt Configurations page", async ({ page }) => {
    await promptsPage.goto();

    // Verify we're on the correct page
    await expect(page).toHaveURL(/\/admin\/prompts/);

    // Verify the page title is visible
    await expect(promptsPage.pageTitle).toBeVisible();
    await expect(promptsPage.pageTitle).toContainText("Prompt Configurations");
  });

  test("Page displays Add button and table", async () => {
    await promptsPage.goto();

    // Verify the Add button is visible
    await expect(promptsPage.addButton).toBeVisible();

    // Verify the data table is visible
    await expect(promptsPage.dataTable).toBeVisible();
  });

  test("Seeded default prompt config is displayed", async () => {
    await promptsPage.goto();

    // The seed creates a "System Default" prompt config
    // There should be at least one row in the table
    const rowCount = await promptsPage.getTableRowCount();
    expect(rowCount).toBeGreaterThan(0);
  });

  test("Navigate via admin menu sidebar", async ({ page }) => {
    // Navigate to any admin page first
    await page.goto("/en-US/admin/projects");
    await page.waitForLoadState("networkidle");

    // The prompts link is in the "Tools & Integrations" section which may be collapsed
    // Expand it if needed
    const toolsSection = page.getByTestId("admin-menu-section-toolsAndIntegrations");
    const toolsTrigger = toolsSection.locator('[data-radix-collection-item]').first();
    // Check if the section content is visible by looking for any link inside
    const promptsLink = page.locator("#admin-menu-prompts");
    if (!(await promptsLink.isVisible({ timeout: 1000 }).catch(() => false))) {
      await toolsTrigger.click();
    }

    await expect(promptsLink).toBeVisible({ timeout: 5000 });
    await promptsLink.click();

    await expect(page).toHaveURL(/\/admin\/prompts/);
    await expect(promptsPage.pageTitle).toBeVisible();
  });
});

test.describe("Prompt Configurations - Create Operations", () => {
  let promptsPage: PromptConfigurationsPage;

  test.beforeEach(async ({ page }) => {
    promptsPage = new PromptConfigurationsPage(page);
    await promptsPage.goto();
  });

  test("Add prompt config with name and description", async () => {
    const configName = `E2E Prompt Config ${Date.now()}`;

    await promptsPage.clickAdd();
    await promptsPage.fillName(configName);
    await promptsPage.fillDescription("Created by E2E test");
    await promptsPage.submitForm();

    // Wait for dialog to close and verify the config appears
    await expect(promptsPage.dialog).not.toBeVisible({ timeout: 10000 });
    await promptsPage.expectConfigInTable(configName);
  });

  test("Add dialog opens with pre-filled default prompts", async ({
    page: _page,
  }) => {
    await promptsPage.clickAdd();

    // Verify the dialog has accordion sections for each feature
    // The accordion may be inside a scrollable container, so scroll to find it
    const accordion = promptsPage.dialog.locator(
      '[data-orientation="vertical"]'
    ).first();
    await expect(accordion).toBeVisible({ timeout: 10000 });

    // Verify at least one feature section exists (e.g., "Test Case Generation")
    const testCaseGen = promptsPage.dialog.locator("text=Test Case Generation");
    await testCaseGen.scrollIntoViewIfNeeded();
    await expect(testCaseGen).toBeVisible({ timeout: 5000 });

    const editorAssistant = promptsPage.dialog.locator("text=Editor Writing Assistant");
    await editorAssistant.scrollIntoViewIfNeeded();
    await expect(editorAssistant).toBeVisible({ timeout: 5000 });
  });

  test("Cannot create config with empty name", async () => {
    await promptsPage.clickAdd();

    // Leave name empty, try to submit
    await promptsPage.submitForm();

    // Dialog should still be visible (validation prevents submission)
    await expect(promptsPage.dialog).toBeVisible();
  });
});

test.describe("Prompt Configurations - Filter", () => {
  let promptsPage: PromptConfigurationsPage;

  test.beforeEach(async ({ page }) => {
    promptsPage = new PromptConfigurationsPage(page);
    await promptsPage.goto();
  });

  test("Filter narrows results", async () => {
    // Filter by a term that won't match anything
    await promptsPage.filterByText("zzz_nonexistent_config_zzz");

    // Table should show no results or fewer results
    const rowCount = await promptsPage.getTableRowCount();
    expect(rowCount).toBe(0);
  });

  test("Clearing filter shows all results", async () => {
    // Apply a filter
    await promptsPage.filterByText("zzz_nonexistent_config_zzz");
    const filteredCount = await promptsPage.getTableRowCount();
    expect(filteredCount).toBe(0);

    // Clear the filter
    await promptsPage.filterByText("");
    const allCount = await promptsPage.getTableRowCount();
    expect(allCount).toBeGreaterThan(0);
  });
});

test.describe("Prompt Configurations - Edit Operations", () => {
  let promptsPage: PromptConfigurationsPage;
  const configName = `E2E Edit Config ${Date.now()}`;

  test.beforeEach(async ({ page, api, baseURL }) => {
    promptsPage = new PromptConfigurationsPage(page);

    // Create a config via API for editing, including prompts for all features.
    // The edit form validates that each feature has a non-empty systemPrompt,
    // so we must create PromptConfigPrompts for every feature.
    const apiBase = baseURL || "http://localhost:3002";
    const features = [
      "markdown_parsing", "test_case_generation", "magic_select_cases",
      "editor_assistant", "llm_test", "export_code_generation", "auto_tag",
    ];

    const response = await api["request"].post(
      `${apiBase}/api/model/promptConfig/create`,
      {
        data: {
          data: {
            name: configName,
            description: "Config for edit testing",
            isDefault: false,
            isActive: true,
            prompts: {
              create: features.map((feature) => ({
                feature,
                systemPrompt: `Default system prompt for ${feature}`,
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
      console.error(`Failed to create prompt config: ${response.status()} - ${errorText}`);
    }

    await promptsPage.goto();
  });

  test("Edit config description", async ({ page: _page }) => {
    await promptsPage.clickEditOnRow(configName);

    const newDescription = `Updated description ${Date.now()}`;
    await promptsPage.fillDescription(newDescription);

    // Scroll the Save button into view and click it
    const saveButton = promptsPage.dialog.locator('button:has-text("Save")');
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();

    // Wait for dialog to close (the save may take time due to prompt feature updates)
    await expect(promptsPage.dialog).not.toBeVisible({ timeout: 30000 });

    // Verify the update persisted by reloading
    await promptsPage.goto();
    await promptsPage.expectConfigInTable(configName);
  });
});

test.describe("Prompt Configurations - Delete Operations", () => {
  let promptsPage: PromptConfigurationsPage;

  test.beforeEach(async ({ page }) => {
    promptsPage = new PromptConfigurationsPage(page);
  });

  test("Delete a non-default config", async ({ page, api, baseURL }) => {
    const configName = `E2E Delete Config ${Date.now()}`;

    // Create a config via API
    const apiBase = baseURL || "http://localhost:3002";
    const response = await api["request"].post(
      `${apiBase}/api/model/promptConfig/create`,
      {
        data: {
          data: {
            name: configName,
            description: "Config for delete testing",
            isDefault: false,
            isActive: true,
          },
        },
      }
    );

    if (!response.ok()) {
      const errorText = await response.text();
      console.error(`Failed to create prompt config: ${response.status()} - ${errorText}`);
    }

    await promptsPage.goto();
    await promptsPage.expectConfigInTable(configName);

    await promptsPage.clickDeleteOnRow(configName);
    await promptsPage.confirmDelete();

    // Wait for toast and verify config is removed
    await page.waitForTimeout(1000);
    await promptsPage.goto();
    await promptsPage.expectConfigNotInTable(configName);
  });

  test("Default config delete button is disabled", async () => {
    await promptsPage.goto();

    // Find the row with the "Default" badge
    const defaultRow = promptsPage.dataTable.locator("tbody tr", {
      hasText: "Default",
    });

    // The delete button should be disabled
    const deleteButton = defaultRow
      .first()
      .locator('button:has([class*="lucide-trash"])');
    await expect(deleteButton).toBeDisabled();
  });
});
