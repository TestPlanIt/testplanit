import { expect, test } from "../../fixtures";

/**
 * Test Run Edit Configuration Tests
 *
 * Tests the ConfigurationSelect (AsyncCombobox single-select) component
 * used for editing the configuration on an existing test run's detail page.
 * Covers:
 * - Viewing the configuration combobox in edit mode
 * - Switching configuration via the combobox
 * - Searching configurations in the edit combobox
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

    // Navigate directly to test run detail page in edit mode
    await page.goto(
      `/en-US/projects/runs/${projectId}/${testRunId}?edit=true`
    );
    await page.waitForLoadState("load");

    // In edit mode, the Configuration field should show an AsyncCombobox
    // The form fields order is: State (Select), Configuration (AsyncCombobox), Milestone, etc.
    // Both State and Configuration use button[role="combobox"], so we need to locate by label.
    // Find the label with "Configuration" text then find the combobox within the same FormItem parent.
    const configLabel = page.locator("label", { hasText: "Configuration" }).first();
    await expect(configLabel).toBeVisible({ timeout: 15000 });
    // The FormItem is the parent of the label; the combobox is a sibling of the label inside the same FormItem
    const configFormItem = configLabel.locator("..");
    const configCombobox = configFormItem.locator('button[role="combobox"]').first();
    await expect(configCombobox).toBeVisible({ timeout: 10000 });

    // Open the combobox
    await configCombobox.click();

    // Wait for the dropdown options to load (AsyncCombobox fetches data)
    await page.waitForTimeout(1000);

    // Verify the configuration appears in the dropdown
    await expect(
      page.locator(`[role="option"]:has-text("${configName}")`)
    ).toBeVisible({ timeout: 10000 });

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

    // Navigate directly in edit mode
    await page.goto(
      `/en-US/projects/runs/${projectId}/${testRunId}?edit=true`
    );
    await page.waitForLoadState("load");

    // Locate the Configuration form section and its combobox via label
    const configLabel = page.locator("label", { hasText: "Configuration" }).first();
    await expect(configLabel).toBeVisible({ timeout: 15000 });
    const configFormItem = configLabel.locator("..");
    const configCombobox = configFormItem.locator('button[role="combobox"]').first();
    await expect(configCombobox).toBeVisible({ timeout: 10000 });
    await configCombobox.click();

    // Wait for options to load
    await page.waitForTimeout(1000);

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

    // Navigate directly in edit mode
    await page.goto(
      `/en-US/projects/runs/${projectId}/${testRunId}?edit=true`
    );
    await page.waitForLoadState("load");

    // Locate the Configuration form section and its combobox via label
    const configLabel = page.locator("label", { hasText: "Configuration" }).first();
    await expect(configLabel).toBeVisible({ timeout: 15000 });
    const configFormItem = configLabel.locator("..");
    const configCombobox = configFormItem.locator('button[role="combobox"]').first();
    await expect(configCombobox).toBeVisible({ timeout: 10000 });
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
