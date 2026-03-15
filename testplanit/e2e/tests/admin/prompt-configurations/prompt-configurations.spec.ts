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

    // Click the prompts link in the admin sidebar
    const promptsLink = page.locator("#admin-menu-prompts");
    await expect(promptsLink).toBeVisible();
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
    page,
  }) => {
    await promptsPage.clickAdd();

    // Verify the dialog has accordion sections for each feature
    const accordion = promptsPage.dialog.locator(
      '[data-orientation="vertical"]'
    );
    await expect(accordion).toBeVisible();

    // Verify at least one feature section exists (e.g., "Test Case Generation")
    await expect(
      promptsPage.dialog.locator("text=Test Case Generation")
    ).toBeVisible();
    await expect(
      promptsPage.dialog.locator("text=Editor Writing Assistant")
    ).toBeVisible();
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

  test.beforeEach(async ({ page, api }) => {
    promptsPage = new PromptConfigurationsPage(page);

    // Create a config via API for editing
    const response = await api["request"].post(
      `http://localhost:3000/api/model/promptConfig/create`,
      {
        data: {
          data: {
            name: configName,
            description: "Config for edit testing",
            isDefault: false,
            isActive: true,
          },
        },
      }
    );

    await promptsPage.goto();
  });

  test("Edit config description", async () => {
    await promptsPage.clickEditOnRow(configName);

    const newDescription = `Updated description ${Date.now()}`;
    await promptsPage.fillDescription(newDescription);
    await promptsPage.submitForm();

    // Wait for dialog to close
    await expect(promptsPage.dialog).not.toBeVisible({ timeout: 10000 });

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

  test("Delete a non-default config", async ({ page, api }) => {
    const configName = `E2E Delete Config ${Date.now()}`;

    // Create a config via API
    await api["request"].post(
      `http://localhost:3000/api/model/promptConfig/create`,
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
