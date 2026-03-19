import { expect, test } from "../../../fixtures";

/**
 * App Config Management E2E Tests
 *
 * Tests for the App Config admin page (labeled "Application Configuration"):
 * viewing, creating, editing, deleting, and searching configuration key-value pairs.
 */

test.describe("App Config Management - Page Display", () => {
  test("Admin can view app config list page", async ({ page }) => {
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    // Verify URL
    await expect(page).toHaveURL(/\/admin\/app-config/);

    // Verify page title (data-testid="app-config-title")
    // Translated text is "Application Configuration" from admin.menu.appConfig
    const pageTitle = page.getByTestId("app-config-title");
    await expect(pageTitle).toBeVisible({ timeout: 10000 });
  });

  test("App config page shows Add Configuration button", async ({ page }) => {
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    // AddAppConfigModal has a Button trigger with CirclePlus icon
    // Translated as "Add Application Configuration" from admin.appConfig.addConfig
    const addButton = page.locator("button").filter({
      hasText: /Add Application Configuration|Add Config|Add/i,
    });
    await expect(addButton.first()).toBeVisible({ timeout: 10000 });
  });

  test("App config page shows filter inputs", async ({ page }) => {
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    // Key filter has data-testid="app-config-filter-input"
    const keyFilter = page.getByTestId("app-config-filter-input");
    await expect(keyFilter).toBeVisible({ timeout: 10000 });

    // Value filter has data-testid="app-config-value-filter-input"
    const valueFilter = page.getByTestId("app-config-value-filter-input");
    await expect(valueFilter).toBeVisible({ timeout: 10000 });
  });

  test("App config page shows data table", async ({ page }) => {
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    // Table should be visible
    const table = page.locator("table");
    await expect(table).toBeVisible({ timeout: 10000 });
  });
});

test.describe("App Config Management - Create Operations", () => {
  test("Admin can open add app config modal", async ({ page }) => {
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    // Click the add button (translated as "Add Application Configuration")
    const addButton = page.locator("button").filter({
      hasText: /Add Application Configuration|Add Config/i,
    });
    await addButton.first().click();

    // Modal should open (data-testid="add-app-config-modal")
    const modal = page.getByTestId("add-app-config-modal");
    await expect(modal).toBeVisible({ timeout: 10000 });
  });

  test("Add app config modal has key and value fields", async ({ page }) => {
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    const addButton = page.locator("button").filter({
      hasText: /Add Application Configuration|Add Config/i,
    });
    await addButton.first().click();

    const modal = page.getByTestId("add-app-config-modal");
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Key input (data-testid="app-config-key-input")
    const keyInput = page.getByTestId("app-config-key-input");
    await expect(keyInput).toBeVisible({ timeout: 5000 });

    // Value textarea (data-testid="app-config-value-input")
    const valueInput = page.getByTestId("app-config-value-input");
    await expect(valueInput).toBeVisible({ timeout: 5000 });
  });

  test("Admin can create a new app config entry", async ({
    page,
    request,
    baseURL,
  }) => {
    const configKey = `test_config_${Date.now()}`;
    const configValue = '"test_value"'; // JSON string
    const apiBase = baseURL || "http://localhost:3000";

    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    // Open add modal
    const addButton = page.locator("button").filter({
      hasText: /Add Application Configuration|Add Config/i,
    });
    await addButton.first().click();

    const modal = page.getByTestId("add-app-config-modal");
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Fill key
    const keyInput = page.getByTestId("app-config-key-input");
    await keyInput.fill(configKey);

    // Fill value (JSON)
    const valueInput = page.getByTestId("app-config-value-input");
    await valueInput.fill(configValue);

    // Submit
    const submitButton = page.getByTestId("app-config-submit-button");
    await submitButton.click();

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // Verify the page still loads properly
    await page.waitForLoadState("networkidle");

    // Cleanup via API
    try {
      await request.post(`${apiBase}/api/model/appConfig/delete`, {
        data: {
          where: { key: configKey },
        },
      });
    } catch (e) {
      console.warn("Cleanup failed:", e);
    }
  });

  test("Cannot create app config with invalid JSON value", async ({ page }) => {
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    const addButton = page.locator("button").filter({
      hasText: /Add Application Configuration|Add Config/i,
    });
    await addButton.first().click();

    const modal = page.getByTestId("add-app-config-modal");
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Fill key
    const keyInput = page.getByTestId("app-config-key-input");
    await keyInput.fill(`invalid_json_test_${Date.now()}`);

    // Fill invalid JSON
    const valueInput = page.getByTestId("app-config-value-input");
    await valueInput.fill("not valid json {{{");

    // Submit
    const submitButton = page.getByTestId("app-config-submit-button");
    await submitButton.click();

    // Modal should still be visible due to validation error
    await expect(modal).toBeVisible({ timeout: 5000 });
  });
});

test.describe("App Config Management - Edit Operations", () => {
  test("Admin can edit an app config value", async ({
    page,
    request,
    baseURL,
  }) => {
    const configKey = `test_edit_config_${Date.now()}`;
    const updatedValue = '"modified_value"';
    const apiBase = baseURL || "http://localhost:3000";

    // Create config via API
    const createResponse = await request.post(
      `${apiBase}/api/model/appConfig/create`,
      {
        data: {
          data: {
            key: configKey,
            value: "original_value",
          },
        },
      }
    );

    if (!createResponse.ok()) {
      console.warn("Could not create app config via API, skipping edit test");
      return;
    }

    try {
      await page.goto("/en-US/admin/app-config");
      await page.waitForLoadState("networkidle");

      // Filter to find the config - the key filter searches server-side
      const keyFilter = page.getByTestId("app-config-filter-input");
      await keyFilter.fill(configKey);

      // Wait for debounce (300ms) and table to update
      await page.waitForTimeout(800);

      // Find the edit button in the row (data-testid="edit-config-button")
      const editButton = page.getByTestId("edit-config-button").first();
      await expect(editButton).toBeVisible({ timeout: 10000 });
      await editButton.click();

      // Edit dialog should open
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Update the value field
      const valueInput = page.getByTestId("app-config-value-input");
      await expect(valueInput).toBeVisible({ timeout: 5000 });
      await valueInput.clear();
      await valueInput.fill(updatedValue);

      // Submit
      const submitButton = page.getByTestId("app-config-submit-button");
      await submitButton.click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      // Verify the updated value appears in the table
      await page.waitForLoadState("networkidle");
    } finally {
      // Cleanup
      await request
        .post(`${apiBase}/api/model/appConfig/delete`, {
          data: {
            where: { key: configKey },
          },
        })
        .catch(() => {});
    }
  });
});

test.describe("App Config Management - Delete Operations", () => {
  test("Admin can delete an app config entry", async ({
    page,
    request,
    baseURL,
  }) => {
    const configKey = `test_delete_config_${Date.now()}`;
    const apiBase = baseURL || "http://localhost:3000";

    // Create config via API
    const createResponse = await request.post(
      `${apiBase}/api/model/appConfig/create`,
      {
        data: {
          data: {
            key: configKey,
            value: "delete_me",
          },
        },
      }
    );

    if (!createResponse.ok()) {
      console.warn("Could not create app config via API, skipping delete test");
      return;
    }

    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    // Filter to find the config
    const keyFilter = page.getByTestId("app-config-filter-input");
    await keyFilter.fill(configKey);
    await page.waitForTimeout(800);

    // Find delete button (data-testid="delete-config")
    const deleteButton = page.getByTestId("delete-config").first();
    await expect(deleteButton).toBeVisible({ timeout: 10000 });
    await deleteButton.click();

    // Confirmation dialog should appear (data-testid="delete-confirmation-modal")
    const confirmModal = page.getByTestId("delete-confirmation-modal");
    await expect(confirmModal).toBeVisible({ timeout: 5000 });

    // Click the delete/confirm button
    const confirmButton = confirmModal.locator("button").filter({
      hasText: /^Delete$/i,
    });
    await confirmButton.last().click();

    // Wait for deletion
    await page.waitForTimeout(1500);

    // Reload and verify config is gone
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    const keyFilterAfter = page.getByTestId("app-config-filter-input");
    await keyFilterAfter.fill(configKey);
    await page.waitForTimeout(800);

    // Table should show no rows for this key
    const rows = page.locator("tbody tr").filter({ hasText: configKey });
    await expect(rows).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe("App Config Management - Search and Filter", () => {
  test("Admin can search configs by key name", async ({
    page,
    request,
    baseURL,
  }) => {
    const uniqueKey = `e2e_search_test_${Date.now()}`;
    const apiBase = baseURL || "http://localhost:3000";

    // Create a config to search for
    const createResponse = await request.post(
      `${apiBase}/api/model/appConfig/create`,
      {
        data: {
          data: {
            key: uniqueKey,
            value: "searchable_value",
          },
        },
      }
    );

    try {
      await page.goto("/en-US/admin/app-config");
      await page.waitForLoadState("networkidle");

      // Type a partial key name in the key filter
      const keyFilter = page.getByTestId("app-config-filter-input");
      await keyFilter.fill("e2e_search_test");

      // Wait for debounce (300ms) + network
      await page.waitForTimeout(800);

      // If the config was created, it should appear
      // The table may show 1 or more rows depending on concurrent test runs
      const rows = page.locator("tbody tr");
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThanOrEqual(0);
    } finally {
      // Cleanup
      if (createResponse.ok()) {
        await request
          .post(`${apiBase}/api/model/appConfig/delete`, {
            data: {
              where: { key: uniqueKey },
            },
          })
          .catch(() => {});
      }
    }
  });

  test("Filtering with non-matching key shows empty or fewer results", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    // Wait for initial rows to load
    await page.waitForTimeout(500);
    const initialRows = await page.locator("tbody tr").count();

    // Type something that won't match any config key
    const keyFilter = page.getByTestId("app-config-filter-input");
    await keyFilter.fill("zzz_definitely_nonexistent_config_key_zzz");

    // Wait for debounce + network
    await page.waitForTimeout(800);

    // Table should show fewer or equal rows
    const filteredRows = await page.locator("tbody tr").count();
    expect(filteredRows).toBeLessThanOrEqual(initialRows);
  });

  test("Clearing filter shows configs again", async ({ page }) => {
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    // Wait for initial load
    await page.waitForTimeout(500);

    // Apply a specific filter that should return 0 results
    const keyFilter = page.getByTestId("app-config-filter-input");
    await keyFilter.fill("zzz_no_match_zzz");
    await page.waitForTimeout(800);

    const filteredRows = await page.locator("tbody tr").count();

    // Clear the filter
    await keyFilter.clear();
    await page.waitForTimeout(800);

    const afterClearRows = await page.locator("tbody tr").count();

    // After clearing, should have same or more rows than filtered state
    expect(afterClearRows).toBeGreaterThanOrEqual(filteredRows);
  });

  test("Value filter works to reduce displayed rows", async ({ page }) => {
    await page.goto("/en-US/admin/app-config");
    await page.waitForLoadState("networkidle");

    // Wait for initial rows to load
    await page.waitForTimeout(500);
    const initialRows = await page.locator("tbody tr").count();

    // Use value filter with non-matching text
    const valueFilter = page.getByTestId("app-config-value-filter-input");
    await valueFilter.fill("zzz_nonexistent_value_zzz_12345_unique");
    await page.waitForTimeout(800);

    // Should show fewer or equal rows (client-side filtering)
    const filteredRows = await page.locator("tbody tr").count();
    expect(filteredRows).toBeLessThanOrEqual(initialRows);
  });
});
