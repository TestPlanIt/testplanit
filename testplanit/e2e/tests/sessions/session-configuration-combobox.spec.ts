import { expect, test } from "../../fixtures";

/**
 * Session Configuration Combobox Tests
 *
 * Tests the AsyncCombobox (single-select) component used for selecting
 * a configuration when creating a new session. Covers:
 * - Opening the combobox and seeing available configurations
 * - Searching/filtering configurations
 * - Selecting a configuration
 * - Selecting the "None" (unassigned) option
 * - Pagination controls in the dropdown
 * - Creating a session with a selected configuration
 */
test.describe("Session Configuration Combobox", () => {
  test("should display configurations in combobox when creating a session", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Session Config ${Date.now()}`
    );
    const configName = `Session Config ${Date.now()}`;
    await api.createConfiguration(configName);

    // Navigate to sessions page
    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Click "New Session" button
    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    // Wait for dialog
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Find the Configuration field's combobox trigger
    // The ConfigurationSelect renders an AsyncCombobox with role="combobox"
    // It's in the right column of the form, after Template and State selects
    const configCombobox = dialog
      .locator('button[role="combobox"]')
      .first();
    await expect(configCombobox).toBeVisible({ timeout: 5000 });

    // Click to open the combobox popover
    await configCombobox.click();

    // Wait for options to load
    const configOption = page.locator(
      `[role="option"]:has-text("${configName}")`
    );
    await expect(configOption).toBeVisible({ timeout: 5000 });
  });

  test("should select a configuration and display it in trigger", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Session Select ${Date.now()}`
    );
    const configName = `Select Config ${Date.now()}`;
    await api.createConfiguration(configName);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Open the modal
    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open config combobox
    const configCombobox = dialog
      .locator('button[role="combobox"]')
      .first();
    await configCombobox.click();

    // Select the configuration
    await page
      .locator(`[role="option"]:has-text("${configName}")`)
      .click();

    // Verify the trigger now shows the selected config name
    await expect(configCombobox).toContainText(configName, { timeout: 5000 });
  });

  test("should show None/unassigned option and allow clearing selection", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Session None ${Date.now()}`
    );
    const configName = `None Config ${Date.now()}`;
    await api.createConfiguration(configName);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Open the modal
    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open config combobox
    const configCombobox = dialog
      .locator('button[role="combobox"]')
      .first();
    await configCombobox.click();

    // First select a configuration
    await page
      .locator(`[role="option"]:has-text("${configName}")`)
      .click();

    // Verify it's selected
    await expect(configCombobox).toContainText(configName, { timeout: 5000 });

    // Re-open and select "None" (unassigned) option
    await configCombobox.click();

    // The ConfigurationSelect has showUnassigned=true, which renders a "None" option
    const noneOption = page.locator('[role="option"][data-value="unassigned"]');
    await expect(noneOption).toBeVisible({ timeout: 5000 });
    await noneOption.click();

    // Verify the trigger no longer shows the config name
    await expect(configCombobox).not.toContainText(configName, {
      timeout: 3000,
    });
  });

  test("should search and filter configurations", async ({ api, page }) => {
    const projectId = await api.createProject(
      `E2E Session Search ${Date.now()}`
    );
    const ts = Date.now();
    const configMatch = `Findable Config ${ts}`;
    const configNoMatch = `Hidden Widget ${ts}`;
    await api.createConfiguration(configMatch);
    await api.createConfiguration(configNoMatch);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open config combobox
    const configCombobox = dialog
      .locator('button[role="combobox"]')
      .first();
    await configCombobox.click();

    // Wait for both to load
    await expect(
      page.locator(`[role="option"]:has-text("${configMatch}")`)
    ).toBeVisible({ timeout: 5000 });

    // Type in the search input
    const searchInput = page
      .locator('[cmdk-input], input[placeholder]')
      .first();
    await searchInput.fill("Findable");

    // Wait for search to apply
    await page.waitForTimeout(500);

    // Matching config should be visible
    await expect(
      page.locator(`[role="option"]:has-text("${configMatch}")`)
    ).toBeVisible({ timeout: 5000 });

    // Non-matching config should not be visible
    await expect(
      page.locator(`[role="option"]:has-text("${configNoMatch}")`)
    ).not.toBeVisible({ timeout: 3000 });
  });

  test("should show pagination controls with Previous/Next buttons", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Session Paging ${Date.now()}`
    );
    const configName = `Paging Config ${Date.now()}`;
    await api.createConfiguration(configName);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open config combobox
    const configCombobox = dialog
      .locator('button[role="combobox"]')
      .first();
    await configCombobox.click();

    // Wait for options
    await expect(
      page.locator(`[role="option"]:has-text("${configName}")`)
    ).toBeVisible({ timeout: 5000 });

    // Verify pagination footer is visible
    const prevButton = page.getByRole("button", { name: "Previous" });
    const nextButton = page.getByRole("button", { name: "Next" });
    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    // Previous should be disabled on first page
    await expect(prevButton).toBeDisabled();

    // Verify page indicator text is shown (e.g., "Showing 1-20 of N")
    const paginationText = page.locator(
      ".text-xs.text-muted-foreground"
    );
    await expect(paginationText).toBeVisible();
  });

  test("should create session with selected configuration", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Session Create ${Date.now()}`
    );
    const configName = `Create Config ${Date.now()}`;
    await api.createConfiguration(configName);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Fill required fields
    const nameInput = dialog.locator('input[name="name"]');
    await nameInput.fill(`E2E Session ${Date.now()}`);

    // Select a configuration
    const configCombobox = dialog
      .locator('button[role="combobox"]')
      .first();
    await configCombobox.click();

    await page
      .locator(`[role="option"]:has-text("${configName}")`)
      .click();

    // Verify config is selected
    await expect(configCombobox).toContainText(configName, { timeout: 5000 });

    // Submit the form
    const submitButton = dialog.getByRole("button", { name: /submit/i });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Wait for dialog to close (indicates successful creation)
    await expect(dialog).not.toBeVisible({ timeout: 15000 });
  });
});
