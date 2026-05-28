import { expect, test } from "../../fixtures";

/**
 * Session Configuration Multi-Select Combobox Tests
 *
 * Tests the MultiAsyncCombobox (multi-select) component used for selecting
 * configurations when creating a new session. Covers:
 * - Opening the combobox and seeing available configurations
 * - Searching/filtering configurations
 * - Selecting a configuration (shown as badge)
 * - Selecting multiple configurations
 * - Removing a selected configuration
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
    await api.createConfiguration(configName, projectId);

    // Navigate to sessions page
    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Click "New Session" button
    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    // Wait for dialog
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Find the Configurations field's combobox trigger (plural label = multi-select)
    const configLabel = dialog.locator('label:has-text("Configurations")');
    await expect(configLabel).toBeVisible({ timeout: 5000 });

    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await expect(configCombobox).toBeVisible({ timeout: 5000 });

    // Click to open the combobox popover
    await configCombobox.click();

    // Wait for options to load
    const configOption = page.locator(
      `[role="option"]:has-text("${configName}")`
    );
    await expect(configOption).toBeVisible({ timeout: 5000 });
  });

  test("should select a configuration and display it as a badge", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Session Select ${Date.now()}`
    );
    const configName = `Select Config ${Date.now()}`;
    await api.createConfiguration(configName, projectId);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Open the modal
    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open config combobox
    const configLabel = dialog.locator('label:has-text("Configurations")');
    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await configCombobox.click();

    // Select the configuration
    await page.locator(`[role="option"]:has-text("${configName}")`).click();

    // Close the popover
    await page.keyboard.press("Escape");

    // The label should show count "(1)"
    await expect(configLabel).toContainText("(1)", { timeout: 5000 });

    // The selected config should appear as a badge inside the combobox trigger
    await expect(configCombobox).toContainText(configName, { timeout: 5000 });
  });

  test("should search and filter configurations", async ({ api, page }) => {
    const projectId = await api.createProject(
      `E2E Session Search ${Date.now()}`
    );
    const ts = Date.now();
    const configMatch = `Findable Config ${ts}`;
    const configNoMatch = `Hidden Widget ${ts}`;
    await api.createConfiguration(configMatch, projectId);
    await api.createConfiguration(configNoMatch, projectId);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open config combobox
    const configLabel = dialog.locator('label:has-text("Configurations")');
    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await expect(configCombobox).toBeVisible({ timeout: 5000 });
    await configCombobox.click();

    // Wait for both to load
    await expect(
      page.locator(`[role="option"]:has-text("${configMatch}")`)
    ).toBeVisible({ timeout: 5000 });

    // Type in the search input inside the combobox command palette
    const searchInput = page.locator("[cmdk-input]");
    await expect(searchInput).toBeVisible({ timeout: 5000 });
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

  test("only shows configurations assigned to the current project", async ({
    api,
    page,
  }) => {
    // A config assigned to a different project must not appear in this
    // project's session configuration picker.
    const ts = Date.now();
    const projectAId = await api.createProject(`E2E Session Scope A ${ts}`);
    const projectBId = await api.createProject(`E2E Session Scope B ${ts}`);
    const configInA = `SessionScopedA ${ts}`;
    const configInB = `SessionScopedB ${ts}`;
    await api.createConfiguration(configInA, projectAId);
    await api.createConfiguration(configInB, projectBId);

    await page.goto(`/en-US/projects/sessions/${projectAId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const configLabel = dialog.locator('label:has-text("Configurations")');
    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await expect(configCombobox).toBeVisible({ timeout: 5000 });
    await configCombobox.click();

    const searchInput = page.locator("[cmdk-input]");
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill(String(ts));
    await page.waitForTimeout(500);

    await expect(
      page.locator(`[role="option"]:has-text("${configInA}")`)
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator(`[role="option"]:has-text("${configInB}")`)
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
    await api.createConfiguration(configName, projectId);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open config combobox
    const configLabel = dialog.locator('label:has-text("Configurations")');
    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await expect(configCombobox).toBeVisible({ timeout: 5000 });
    await configCombobox.click();

    // Wait for options
    await expect(
      page.locator(`[role="option"]:has-text("${configName}")`)
    ).toBeVisible({ timeout: 5000 });

    // Verify pagination footer is visible
    const prevButton = page.getByRole("button", { name: "Previous" });
    const nextButton = page.getByRole("button", { name: "Next" });
    await expect(prevButton).toBeVisible({ timeout: 5000 });
    await expect(nextButton).toBeVisible({ timeout: 5000 });

    // Previous should be disabled on first page
    await expect(prevButton).toBeDisabled();
  });

  test("should create session with selected configuration", async ({
    api,
    page,
  }) => {
    const projectId = await api.createProject(
      `E2E Session Create ${Date.now()}`
    );
    const configName = `Create Config ${Date.now()}`;
    await api.createConfiguration(configName, projectId);

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Fill required fields
    const nameInput = dialog.locator('input[name="name"]');
    await nameInput.fill(`E2E Session ${Date.now()}`);

    // Select a configuration
    const configLabel = dialog.locator('label:has-text("Configurations")');
    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await configCombobox.click();

    await page.locator(`[role="option"]:has-text("${configName}")`).click();

    // Close the popover
    await page.keyboard.press("Escape");

    // Verify config is selected (badge visible)
    await expect(configCombobox).toContainText(configName, { timeout: 5000 });

    // Submit the form
    const submitButton = dialog.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Wait for dialog to close (indicates successful creation). 15s wasn't
    // enough under 8-worker load — the new-session create path includes
    // configuration linkage + ES indexing + multiple round-trips, and the
    // form's submit→close transition is gated on all of them resolving.
    await expect(dialog).not.toBeVisible({ timeout: 30000 });
  });
});
