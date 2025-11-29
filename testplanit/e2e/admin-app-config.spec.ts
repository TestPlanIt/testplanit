import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

// Base URL for admin section (adjust locale as needed, or handle dynamically)
const ADMIN_BASE_URL = "/en-US/admin";

test.describe.serial("Admin - App Config Management @app-config", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  const createConfigEntry = async (
    page: any,
    { key, value }: { key: string; value: any }
  ) => {
    // Click the add button using the correct text
    const addButton = page.getByRole("button", {
      name: "Add Application Configuration",
    });
    await addButton.click();

    // Wait for modal to appear using test id
    const modal = page.getByTestId("add-app-config-modal");
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Fill in the form using correct test ids
    await modal.getByTestId("app-config-key-input").fill(key);
    await modal
      .getByTestId("app-config-value-input")
      .fill(JSON.stringify(value));

    // Submit the form
    await modal.getByTestId("app-config-submit-button").click();

    // Wait for the modal to close
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // Reload the page to ensure we see the latest data
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Wait for the table to load
    await page.waitForSelector("table", { timeout: 10000 });

    // Wait for the new entry to appear in the table
    // The value might be displayed without quotes, so check for both
    const valueWithoutQuotes = value.toString().replace(/^"|"$/g, "");

    // Check if the entry exists in the table
    // First check if we can find the key or value anywhere on the page
    const pageText = await page.textContent("body");
    if (
      !pageText?.includes(key) &&
      !pageText?.includes(valueWithoutQuotes) &&
      !pageText?.includes(value)
    ) {
      // If not found, try searching for it
      const searchInput = page
        .locator(
          'input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i]'
        )
        .first();
      if (await searchInput.isVisible()) {
        await searchInput.fill(key);
        await page.waitForTimeout(500);
      }
    }

    // Now look for the row
    const rowLocator = page
      .locator("tr")
      .filter({ hasText: valueWithoutQuotes })
      .or(
        page
          .locator("tr")
          .filter({ hasText: value })
          .or(page.locator("tr").filter({ hasText: key }))
      );

    await expect(rowLocator).toBeVisible({ timeout: 15000 });
  };

  test("should display the app config page", async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/app-config`);
    // Check for title and essential elements
    await expect(page.getByTestId("app-config-title")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText("Add Application Configuration", { exact: true })
    ).toBeVisible();
    await expect(page.getByTestId("app-config-filter-input")).toBeVisible();
    // Check for table headers using getByText
    await expect(page.getByText("Key", { exact: true })).toBeVisible();
    await expect(page.getByText("Value", { exact: true })).toBeVisible();
    await expect(page.getByText("Actions", { exact: true })).toBeVisible();
  });

  test("should add a new configuration entry", async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/app-config`);
    await createConfigEntry(page, {
      key: `e2e-add-${Date.now()}`,
      value: `value-${Date.now()}`,
    });
  });

  test("should edit an existing configuration entry", async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/app-config`);
    const key = `e2e-edit-${Date.now()}`;
    const initialValue = `initial-${Date.now()}`;
    const editedValue = `edited-${Date.now()}`;

    // 1. Create the entry to edit
    await createConfigEntry(page, { key, value: initialValue });

    // 2. Find and edit the entry
    // After page reload in createConfigEntry, we need to wait for the table to load
    await page.waitForSelector("table", { timeout: 10000 });

    // The key might be localized, so look for the row by value instead
    const rowToEdit = page.locator("tr").filter({ hasText: initialValue });

    // Wait for the row to be visible before clicking
    await expect(rowToEdit).toBeVisible({ timeout: 15000 });

    // Click the edit button using test id
    const editButton = rowToEdit.getByTestId("edit-config-button");
    await editButton.click();

    // Wait for the modal to appear
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Edit the value using test id
    const valueEditInput = modal.getByTestId("app-config-value-input");
    await valueEditInput.clear();
    await valueEditInput.fill(JSON.stringify(editedValue));

    // Click the submit button
    await modal.getByTestId("app-config-submit-button").click();

    // Wait for the modal to close
    await expect(modal).not.toBeVisible({ timeout: 10000 });

    // Verify the edit was saved
    await expect(
      page.locator("tr").filter({ hasText: editedValue })
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator("tr").filter({ hasText: initialValue })
    ).not.toBeVisible();
  });

  test("should filter the table by key", async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/app-config`);
    const key = `e2e-filter-${Date.now()}`;
    const value = `value-${Date.now()}`;

    // 1. Create an entry to filter for
    await createConfigEntry(page, { key, value });

    // 2. Filter and verify
    // Use the correct test id for the key filter
    const filterInput = page.getByTestId("app-config-filter-input");
    await filterInput.fill(key);

    const filteredRow = page.locator("tr", { has: page.getByText(value) });
    await expect(filteredRow).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(2); // Header + 1 filtered row

    // 3. Clear filter and verify
    await filterInput.clear();
    await expect(page.getByRole("row").nth(2)).toBeVisible(); // at least 2 data rows visible
  });

  test("should delete a configuration entry", async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/app-config`);
    const key = `e2e-delete-${Date.now()}`;
    const value = `value-to-delete-${Date.now()}`;

    await createConfigEntry(page, {
      key: key,
      value: value,
    });

    // Find the row by value instead of key (since key might be localized)
    const row = page.locator("tr").filter({ hasText: value });
    await expect(row).toBeVisible({ timeout: 10000 });

    // Click the delete button using test id
    const deleteButton = row.getByTestId("delete-config");
    await deleteButton.click();

    // Handle the confirmation modal
    const confirmationModal = page.getByTestId("delete-confirmation-modal");
    await expect(confirmationModal).toBeVisible({ timeout: 10000 });

    // Click the delete button in the modal
    await confirmationModal.getByRole("button", { name: "Delete" }).click();

    // Wait for the modal to close
    await expect(confirmationModal).not.toBeVisible({ timeout: 10000 });

    // Verify the entry is deleted
    await expect(page.locator("tr").filter({ hasText: value })).not.toBeVisible(
      { timeout: 10000 }
    );
  });
});
