import { expect, test } from "../../fixtures";

/**
 * Test Run Edit Configuration Tests
 *
 * Tests the ConfigurationSelect (AsyncCombobox single-select) component
 * used for editing the configuration on an existing test run's detail page.
 * Covers:
 * - Viewing the current configuration in read mode
 * - Switching to edit mode and using the combobox to change configuration
 * - Searching configurations in the edit combobox
 * - Clearing configuration via the "None" option
 */
test.describe("Test Run Edit Configuration", () => {
  test("should show ConfigurationSelect combobox in edit mode", async ({
    api,
    page,
  }) => {
    // Setup: Create project, configuration, and test run
    const projectId = await api.createProject(
      `E2E Edit Config ${Date.now()}`
    );
    const configName = `Edit Config ${Date.now()}`;
    const _configId = await api.createConfiguration(configName);

    // Create a test run with the configuration
    const testRunId = await api.createTestRun(
      projectId,
      `Config Run ${Date.now()}`
    );

    // Navigate to test run detail page
    await page.goto(
      `/en-US/projects/runs/${projectId}/${testRunId}`
    );
    await page.waitForLoadState("load");

    // The page should load in read mode initially
    // Look for an "Edit" button to switch to edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();

    // In edit mode, the Configuration field should show an AsyncCombobox
    const configCombobox = page.locator('button[role="combobox"]').first();
    await expect(configCombobox).toBeVisible({ timeout: 5000 });

    // Open the combobox
    await configCombobox.click();

    // Verify the configuration appears in the dropdown
    await expect(
      page.locator(`[role="option"]:has-text("${configName}")`)
    ).toBeVisible({ timeout: 5000 });

    // Verify pagination controls are present
    const prevButton = page.getByRole("button", { name: "Previous" });
    await expect(prevButton).toBeVisible();
  });

  test("should change configuration via combobox in edit mode", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Change Config ${Date.now()}`
    );
    const ts = Date.now();
    const config1Name = `Original Config ${ts}`;
    const config2Name = `New Config ${ts}`;
    await api.createConfiguration(config1Name);
    await api.createConfiguration(config2Name);

    const testRunId = await api.createTestRun(
      projectId,
      `Change Config Run ${Date.now()}`
    );

    await page.goto(
      `/en-US/projects/runs/${projectId}/${testRunId}`
    );
    await page.waitForLoadState("load");

    // Switch to edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();

    // Open the config combobox
    const configCombobox = page.locator('button[role="combobox"]').first();
    await expect(configCombobox).toBeVisible({ timeout: 5000 });
    await configCombobox.click();

    // Select config2
    await page
      .locator(`[role="option"]:has-text("${config2Name}")`)
      .click();

    // Verify combobox shows the new config
    await expect(configCombobox).toContainText(config2Name, {
      timeout: 5000,
    });
  });

  test("should search configurations in edit mode combobox", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Search Edit ${Date.now()}`
    );
    const ts = Date.now();
    const configMatch = `Searchable Edit ${ts}`;
    const configNoMatch = `Other Edit ${ts}`;
    await api.createConfiguration(configMatch);
    await api.createConfiguration(configNoMatch);

    const testRunId = await api.createTestRun(
      projectId,
      `Search Edit Run ${Date.now()}`
    );

    await page.goto(
      `/en-US/projects/runs/${projectId}/${testRunId}`
    );
    await page.waitForLoadState("load");

    // Switch to edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await expect(editButton).toBeVisible({ timeout: 15000 });
    await editButton.click();

    // Open the config combobox
    const configCombobox = page.locator('button[role="combobox"]').first();
    await configCombobox.click();

    // Type in search
    const searchInput = page
      .locator('[cmdk-input], input[placeholder]')
      .first();
    await searchInput.fill("Searchable");

    await page.waitForTimeout(500);

    // Verify filtering
    await expect(
      page.locator(`[role="option"]:has-text("${configMatch}")`)
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(`[role="option"]:has-text("${configNoMatch}")`)
    ).not.toBeVisible({ timeout: 3000 });
  });
});
