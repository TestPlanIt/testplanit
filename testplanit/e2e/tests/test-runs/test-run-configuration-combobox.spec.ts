import { expect, test } from "../../fixtures";

/**
 * Test Run Configuration Combobox Tests
 *
 * Tests the MultiAsyncCombobox component used for selecting configurations
 * when creating a new test run. Covers:
 * - Opening the combobox and seeing available configurations
 * - Searching/filtering configurations
 * - Selecting multiple configurations (badge display)
 * - Removing selected configurations via badge X button
 * - Select All functionality
 * - Pagination in the combobox dropdown
 */
test.describe("Test Run Configuration Combobox", () => {
  test("should display configurations in multi-select combobox when creating a test run", async ({
    api,
    page,
  }) => {
    // Setup: Create project and configurations
    const projectId = await api.createProject(
      `E2E Config Combobox ${Date.now()}`
    );
    const configName1 = `Config Alpha ${Date.now()}`;
    const configName2 = `Config Beta ${Date.now()}`;
    await api.createConfiguration(configName1);
    await api.createConfiguration(configName2);

    // Navigate to test runs page
    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Click the "New Run" button to open the AddTestRunModal
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    // Wait for the dialog to appear
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Find the configurations combobox trigger (role="combobox" inside the form)
    const configCombobox = dialog.locator('button[role="combobox"]').first();
    await expect(configCombobox).toBeVisible({ timeout: 5000 });

    // Click to open the combobox popover
    await configCombobox.click();

    // Wait for the popover/command list to appear
    const popover = page.locator('[role="listbox"], [cmdk-list]').first();
    await expect(popover).toBeVisible({ timeout: 5000 });

    // Verify configurations appear in the dropdown
    await expect(
      page.locator(`[role="option"]:has-text("${configName1}")`)
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(`[role="option"]:has-text("${configName2}")`)
    ).toBeVisible();
  });

  test("should select and display configuration as badge", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Config Badge ${Date.now()}`
    );
    const configName = `Badge Config ${Date.now()}`;
    await api.createConfiguration(configName);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Open AddTestRunModal
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open the config combobox
    const configCombobox = dialog.locator('button[role="combobox"]').first();
    await configCombobox.click();

    // Select a configuration
    const configOption = page.locator(
      `[role="option"]:has-text("${configName}")`
    );
    await expect(configOption).toBeVisible({ timeout: 5000 });
    await configOption.click();

    // Verify the selected configuration appears as a badge in the trigger button
    // The MultiAsyncCombobox renders selected items as Badge components
    const badge = dialog.locator(
      `[data-slot="badge"]:has-text("${configName}")`
    );
    await expect(badge).toBeVisible({ timeout: 5000 });
  });

  test("should remove configuration by clicking badge X button", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Config Remove ${Date.now()}`
    );
    const configName = `Remove Config ${Date.now()}`;
    await api.createConfiguration(configName);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Open AddTestRunModal
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open combobox and select a configuration
    const configCombobox = dialog.locator('button[role="combobox"]').first();
    await configCombobox.click();

    const configOption = page.locator(
      `[role="option"]:has-text("${configName}")`
    );
    await expect(configOption).toBeVisible({ timeout: 5000 });
    await configOption.click();

    // Verify badge is visible
    const badge = dialog.locator(
      `[data-slot="badge"]:has-text("${configName}")`
    );
    await expect(badge).toBeVisible({ timeout: 5000 });

    // Click the X button on the badge to remove it
    const removeButton = badge.locator('[role="button"]');
    await removeButton.click();

    // Verify badge is no longer visible
    await expect(badge).not.toBeVisible({ timeout: 3000 });
  });

  test("should search and filter configurations in combobox", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Config Search ${Date.now()}`
    );
    const ts = Date.now();
    const configNameMatch = `Searchable Config ${ts}`;
    const configNameNoMatch = `Other Widget ${ts}`;
    await api.createConfiguration(configNameMatch);
    await api.createConfiguration(configNameNoMatch);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Open AddTestRunModal
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open the config combobox
    const configCombobox = dialog.locator('button[role="combobox"]').first();
    await configCombobox.click();

    // Both configs should be visible initially
    await expect(
      page.locator(`[role="option"]:has-text("${configNameMatch}")`)
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(`[role="option"]:has-text("${configNameNoMatch}")`)
    ).toBeVisible();

    // Type in the search input to filter
    const searchInput = page.locator('[cmdk-input], input[placeholder]').first();
    await searchInput.fill("Searchable");

    // Wait for filtering
    await page.waitForTimeout(500);

    // Matching config should be visible, non-matching should not
    await expect(
      page.locator(`[role="option"]:has-text("${configNameMatch}")`)
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(`[role="option"]:has-text("${configNameNoMatch}")`)
    ).not.toBeVisible({ timeout: 3000 });
  });

  test("should select multiple configurations", async ({ api, page }) => {
    const projectId = await api.createProject(
      `E2E Multi Config ${Date.now()}`
    );
    const ts = Date.now();
    const config1 = `Multi A ${ts}`;
    const config2 = `Multi B ${ts}`;
    const config3 = `Multi C ${ts}`;
    await api.createConfiguration(config1);
    await api.createConfiguration(config2);
    await api.createConfiguration(config3);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Open AddTestRunModal
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open the config combobox
    const configCombobox = dialog.locator('button[role="combobox"]').first();
    await configCombobox.click();

    // Select first configuration
    await page
      .locator(`[role="option"]:has-text("${config1}")`)
      .click();

    // Re-open combobox (MultiAsyncCombobox stays open after selection, but
    // the selected option is hidden when hideSelected=true)
    // Verify it's hidden from the list
    await expect(
      page.locator(`[role="option"]:has-text("${config1}")`)
    ).not.toBeVisible({ timeout: 3000 });

    // Select second configuration
    await page
      .locator(`[role="option"]:has-text("${config2}")`)
      .click();

    // Close the popover by pressing Escape
    await page.keyboard.press("Escape");

    // Verify both badges are visible
    await expect(
      dialog.locator(`[data-slot="badge"]:has-text("${config1}")`)
    ).toBeVisible({ timeout: 5000 });
    await expect(
      dialog.locator(`[data-slot="badge"]:has-text("${config2}")`)
    ).toBeVisible();
  });

  test("should use Select All to bulk select configurations", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Select All ${Date.now()}`
    );
    const ts = Date.now();
    const config1 = `SelectAll A ${ts}`;
    const config2 = `SelectAll B ${ts}`;
    await api.createConfiguration(config1);
    await api.createConfiguration(config2);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Open AddTestRunModal
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open the config combobox
    const configCombobox = dialog.locator('button[role="combobox"]').first();
    await configCombobox.click();

    // Wait for options to load
    await expect(
      page.locator(`[role="option"]:has-text("${config1}")`)
    ).toBeVisible({ timeout: 5000 });

    // Click "Select All" option
    const selectAllOption = page.locator(
      '[role="option"][data-value="__select_all__"]'
    );
    await expect(selectAllOption).toBeVisible({ timeout: 3000 });
    await selectAllOption.click();

    // Close the popover
    await page.keyboard.press("Escape");

    // Verify both configurations are selected as badges
    await expect(
      dialog.locator(`[data-slot="badge"]:has-text("${config1}")`)
    ).toBeVisible({ timeout: 5000 });
    await expect(
      dialog.locator(`[data-slot="badge"]:has-text("${config2}")`)
    ).toBeVisible();
  });

  test("should show Clear All link when configurations are selected", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Clear All ${Date.now()}`
    );
    const configName = `ClearAll Config ${Date.now()}`;
    await api.createConfiguration(configName);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Open AddTestRunModal
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open combobox and select a config
    const configCombobox = dialog.locator('button[role="combobox"]').first();
    await configCombobox.click();

    await page
      .locator(`[role="option"]:has-text("${configName}")`)
      .click();

    // Close popover
    await page.keyboard.press("Escape");

    // Verify badge is visible
    await expect(
      dialog.locator(`[data-slot="badge"]:has-text("${configName}")`)
    ).toBeVisible({ timeout: 5000 });

    // Click "Clear All" link
    const clearAll = dialog.locator('span:has-text("Clear All")');
    await expect(clearAll).toBeVisible();
    await clearAll.click();

    // Verify badge is removed
    await expect(
      dialog.locator(`[data-slot="badge"]:has-text("${configName}")`)
    ).not.toBeVisible({ timeout: 3000 });
  });

  test("should show pagination controls in combobox dropdown", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Config Pagination ${Date.now()}`
    );

    // The combobox uses local filtering with configurationsOptions which are
    // fetched via useFindManyConfigurations. The MultiAsyncCombobox has
    // pagination with "Previous" and "Next" buttons.
    const configName = `Paginated Config ${Date.now()}`;
    await api.createConfiguration(configName);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Open AddTestRunModal
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open the config combobox
    const configCombobox = dialog.locator('button[role="combobox"]').first();
    await configCombobox.click();

    // Wait for options to appear
    await expect(
      page.locator(`[role="option"]:has-text("${configName}")`)
    ).toBeVisible({ timeout: 5000 });

    // Verify pagination footer is visible with Previous/Next buttons
    const prevButton = page.getByRole("button", { name: "Previous" });
    const nextButton = page.getByRole("button", { name: "Next" });
    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    // Previous should be disabled on first page
    await expect(prevButton).toBeDisabled();
  });

  test("should proceed to step 2 with selected configurations", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Config Next Step ${Date.now()}`
    );
    const configName = `NextStep Config ${Date.now()}`;
    await api.createConfiguration(configName);

    // Create a folder and test case so step 2 has cases to show
    const folderId = await api.createFolder(projectId, "Test Folder");
    await api.createTestCase(projectId, folderId, `Test Case ${Date.now()}`);

    await page.goto(`/en-US/projects/runs/${projectId}`);
    await page.waitForLoadState("load");

    // Open AddTestRunModal
    const newRunButton = page.getByTestId("new-run-button");
    await expect(newRunButton).toBeVisible({ timeout: 15000 });
    await newRunButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Fill in required name field
    const nameInput = page.getByTestId("run-name-input");
    await nameInput.fill(`Test Run ${Date.now()}`);

    // Select a configuration
    const configCombobox = dialog.locator('button[role="combobox"]').first();
    await configCombobox.click();

    await page
      .locator(`[role="option"]:has-text("${configName}")`)
      .click();

    await page.keyboard.press("Escape");

    // Click "Next" to go to step 2
    const nextButton = page.getByTestId("run-next-button");
    await expect(nextButton).toBeVisible();
    await nextButton.click();

    // Verify step 2 is shown (test case selection with repository)
    // The dialog should now show the repository/case selection view
    await expect(
      dialog.locator('text="Save"').or(page.getByTestId("run-save-button"))
    ).toBeVisible({ timeout: 10000 });
  });
});
