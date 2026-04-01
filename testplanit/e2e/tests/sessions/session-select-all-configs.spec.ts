import { expect, test } from "../../fixtures";

/**
 * Session Configuration Select All Tests
 *
 * Tests that the "Select All" button in the MultiAsyncCombobox correctly
 * displays the total count across all pages and selects all items.
 */
test.describe("Session Configuration Select All", () => {
  test("should show accurate total in Select All when more configs than page size", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E SelectAll ${ts}`);

    // Create 12 configurations (more than default page size of 10)
    const configNames: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const name = `SelectAll Config ${String(i).padStart(2, "0")} ${ts}`;
      configNames.push(name);
      await api.createConfiguration(name);
    }

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    // Open Add Session dialog
    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open the configurations combobox
    const configLabel = dialog.locator(
      'label:has-text("Configurations")'
    );
    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await configCombobox.click();

    // Wait for options to load
    await page.waitForTimeout(1000);

    // The "Select All" option should show the total count, not just page count
    // Since there are 12+ configs total (possibly more from other tests),
    // the count should be greater than 10 (the page size)
    const selectAllOption = page.locator(
      '[role="option"][data-value="__select_all__"]'
    );
    await expect(selectAllOption).toBeVisible({ timeout: 5000 });

    // Extract the count from "Select All (N)"
    const selectAllText = await selectAllOption.textContent();
    const match = selectAllText?.match(/\((\d+)\)/);
    expect(match).not.toBeNull();
    const count = parseInt(match![1], 10);

    // Should be at least 12 (our configs, plus possibly pre-existing ones)
    expect(count).toBeGreaterThanOrEqual(12);

    // The page indicator should show "1-10 of N" confirming we're on page 1
    const paginationText = page.locator('text=/1–10 of/');
    await expect(paginationText).toBeVisible({ timeout: 5000 });
  });

  test("should select all configurations across pages when clicking Select All", async ({
    api,
    page,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E SelectAllClick ${ts}`);

    // Create 12 configurations
    for (let i = 1; i <= 12; i++) {
      await api.createConfiguration(
        `AllClick Config ${String(i).padStart(2, "0")} ${ts}`
      );
    }

    await page.goto(`/en-US/projects/sessions/${projectId}`);
    await page.waitForLoadState("load");

    const newSessionButton = page.getByTestId("new-session-button");
    await expect(newSessionButton).toBeVisible({ timeout: 15000 });
    await newSessionButton.click();

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Open the configurations combobox
    const configLabel = dialog.locator(
      'label:has-text("Configurations")'
    );
    const configCombobox = configLabel
      .locator("..")
      .locator('button[role="combobox"]');
    await configCombobox.click();
    await page.waitForTimeout(1000);

    // Click Select All
    const selectAllOption = page.locator(
      '[role="option"][data-value="__select_all__"]'
    );
    await expect(selectAllOption).toBeVisible({ timeout: 5000 });
    await selectAllOption.click();

    // Wait for Select All to process (it fetches all items asynchronously)
    await page.waitForTimeout(2000);

    // Close the popover
    await page.keyboard.press("Escape");

    // The label count should show at least 12
    // Wait for the label to update with the count
    await expect(configLabel).toContainText("(", { timeout: 5000 });
    const labelText = await configLabel.textContent();
    const match = labelText?.match(/\((\d+)\)/);
    expect(match).not.toBeNull();
    const selectedCount = parseInt(match![1], 10);
    expect(selectedCount).toBeGreaterThanOrEqual(12);

    // The Create button should show the count
    const createButton = dialog.locator('button[type="submit"]');
    await expect(createButton).toContainText(`(${selectedCount})`, {
      timeout: 5000,
    });
  });
});
