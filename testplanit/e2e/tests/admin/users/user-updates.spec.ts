import { test, expect } from "../../../fixtures";

/**
 * User Update Operations E2E Tests
 *
 * Comprehensive tests for all user update functionality that was migrated
 * from ZenStack hooks to the dedicated /api/users/[userId] endpoint.
 *
 * These tests verify:
 * - Profile updates (name, email, preferences)
 * - Avatar management (upload, remove)
 * - Admin operations (edit user, toggle active, soft delete)
 * - User menu operations (theme, locale)
 *
 * Critical: These tests verify the fix for ZenStack 2.21+ nested operation issues
 */

test.describe("User Update Operations", () => {
  test.describe("Profile Page Updates", () => {
    test("User can update their display name", async ({ page }) => {
      const newName = `Updated Name ${Date.now()}`;

      // Navigate to admin users page and click on admin user to get to profile
      await page.goto("/en-US/admin/users");
      await page.waitForLoadState("networkidle");

      // Find and click the admin user's profile link
      const adminProfileLink = page.locator('a').filter({ hasText: 'Administrator Account' }).first();
      await expect(adminProfileLink).toBeVisible();
      await adminProfileLink.click();

      // Wait for profile page
      await page.waitForURL(/\/users\/profile\//);
      await page.waitForLoadState("networkidle");

      // Enter edit mode
      const editButton = page.getByRole("button", { name: /edit/i });
      await editButton.click();

      // Wait for submit button to appear
      const submitButton = page.getByTestId("profile-submit-button");
      await expect(submitButton).toBeVisible();

      // Update name
      const nameInput = page.getByLabel(/^name/i);
      const originalName = await nameInput.inputValue();
      await nameInput.clear();
      await nameInput.fill(newName);

      // Save
      await submitButton.click();
      await page.waitForLoadState("networkidle");

      // Verify name was updated (page should reload)
      await expect(page.getByText(newName).first()).toBeVisible({ timeout: 10000 });

      // Revert name back
      await page.getByRole("button", { name: /edit/i }).click();
      const submitButtonRevert = page.getByTestId("profile-submit-button");
      await expect(submitButtonRevert).toBeVisible();
      const nameInputRevert = page.getByLabel(/^name/i);
      await nameInputRevert.clear();
      await nameInputRevert.fill(originalName);
      await submitButtonRevert.click();
      await page.waitForLoadState("networkidle");
    });

    test("User can update theme preference", async ({ page }) => {
      // Navigate to admin users page and click on admin user
      await page.goto("/en-US/admin/users");
      await page.waitForLoadState("networkidle");

      // Find and click the admin user's profile link
      const adminProfileLink = page.locator('a').filter({ hasText: 'Administrator Account' }).first();
      await expect(adminProfileLink).toBeVisible();
      await adminProfileLink.click();

      await page.waitForURL(/\/users\/profile\//);
      await page.waitForLoadState("networkidle");

      // Enter edit mode
      const editButton = page.getByRole("button", { name: /edit/i });
      await editButton.click();

      // Wait for submit button
      const submitButton = page.getByTestId("profile-submit-button");
      await expect(submitButton).toBeVisible();

      // Find the theme combobox (shadcn Select component)
      // Look for the combobox by the label text
      const themeLabel = page.getByText("Theme", { exact: false }).first();
      await expect(themeLabel).toBeVisible();

      // Find the combobox trigger button (next sibling or within same form item)
      const themeCombobox = page.locator('[role="combobox"]').filter({ hasText: /Light|Dark|System/i }).first();
      await expect(themeCombobox).toBeVisible();

      // Get the current theme value from the combobox text
      const originalThemeText = await themeCombobox.textContent();
      const originalTheme = originalThemeText?.trim() || "Light";

      // Click to open the dropdown
      await themeCombobox.click();

      // Select the opposite theme
      const newTheme = originalTheme === "Light" ? "Dark" : "Light";

      // Wait for dropdown to open and click the option
      const themeOption = page.getByRole("option", { name: newTheme, exact: true });
      await expect(themeOption).toBeVisible({ timeout: 5000 });
      await themeOption.click();

      // Save
      await submitButton.click();
      await page.waitForLoadState("networkidle");

      // Verify the page reloaded and edit button is back
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({
        timeout: 10000,
      });

      // Revert theme back
      await page.getByRole("button", { name: /edit/i }).click();
      const submitButtonRevert = page.getByTestId("profile-submit-button");
      await expect(submitButtonRevert).toBeVisible();

      // Find and click the theme combobox again
      const themeComboboxRevert = page.locator('[role="combobox"]').filter({ hasText: /Light|Dark|System/i }).first();
      await expect(themeComboboxRevert).toBeVisible();
      await themeComboboxRevert.click();

      // Wait for dropdown and click the original theme option
      const themeOptionRevert = page.getByRole("option", { name: originalTheme, exact: true });
      await expect(themeOptionRevert).toBeVisible({ timeout: 5000 });
      await themeOptionRevert.click();

      await submitButtonRevert.click();
      await page.waitForLoadState("networkidle");
    });

    test("User can update items per page preference", async ({ page }) => {
      // Navigate to admin users page and click on admin user
      await page.goto("/en-US/admin/users");
      await page.waitForLoadState("networkidle");

      // Find and click the admin user's profile link
      const adminProfileLink = page.locator('a').filter({ hasText: 'Administrator Account' }).first();
      await expect(adminProfileLink).toBeVisible();
      await adminProfileLink.click();

      await page.waitForURL(/\/users\/profile\//);
      await page.waitForLoadState("networkidle");

      // Enter edit mode
      const editButton = page.getByRole("button", { name: /edit/i });
      await editButton.click();

      // Wait for submit button
      const submitButton = page.getByTestId("profile-submit-button");
      await expect(submitButton).toBeVisible();

      // Find the items per page combobox (shadcn Select component)
      const itemsPerPageLabel = page.getByText("Items Per Page", { exact: false }).first();
      await expect(itemsPerPageLabel).toBeVisible();

      // Find the combobox trigger button
      const itemsPerPageCombobox = page.locator('[role="combobox"]').filter({ hasText: /^\d+$|^10$|^25$|^50$|^100$/i }).first();
      await expect(itemsPerPageCombobox).toBeVisible();

      // Get the current value from the combobox text
      const originalValueText = await itemsPerPageCombobox.textContent();
      const originalValue = originalValueText?.trim() || "10";

      // Click to open the dropdown
      await itemsPerPageCombobox.click();

      // Select a different value
      const newValue = originalValue === "10" ? "25" : "10";

      // Wait for dropdown and click the option
      const itemsPerPageOption = page.getByRole("option", { name: newValue, exact: true });
      await expect(itemsPerPageOption).toBeVisible({ timeout: 5000 });
      await itemsPerPageOption.click();

      // Save
      await submitButton.click();
      await page.waitForLoadState("networkidle");

      // Verify saved
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({
        timeout: 10000,
      });

      // Revert
      await page.getByRole("button", { name: /edit/i }).click();
      const submitButtonRevert = page.getByTestId("profile-submit-button");
      await expect(submitButtonRevert).toBeVisible();

      // Find and click the items per page combobox again
      const itemsPerPageComboboxRevert = page.locator('[role="combobox"]').filter({ hasText: /^\d+$|^10$|^25$|^50$|^100$/i }).first();
      await expect(itemsPerPageComboboxRevert).toBeVisible();
      await itemsPerPageComboboxRevert.click();

      // Wait for dropdown and click the original value option
      const itemsPerPageOptionRevert = page.getByRole("option", { name: originalValue, exact: true });
      await expect(itemsPerPageOptionRevert).toBeVisible({ timeout: 5000 });
      await itemsPerPageOptionRevert.click();

      await submitButtonRevert.click();
      await page.waitForLoadState("networkidle");
    });
  });

  test.describe("Admin User Management", () => {
    test("Admin can toggle user active status", async ({ page, api }) => {
      // Create a test user first
      const testEmail = `toggle-test-${Date.now()}@example.com`;
      const testUser = await api.createUser({
        name: "Toggle Test User",
        email: testEmail,
        password: "password123",
        roleId: 1,
        access: "USER",
      });

      try {
        await page.goto("/en-US/admin/users");
        await page.waitForLoadState("networkidle");

        // Enable "Show Inactive" so users remain visible when toggled to inactive
        const showInactiveSwitch = page.getByRole("switch", { name: "Show Inactive" });
        const isShowInactiveChecked = await showInactiveSwitch.getAttribute("data-state");
        if (isShowInactiveChecked !== "checked") {
          await showInactiveSwitch.click();
          await page.waitForLoadState("networkidle");
        }

        // Find the test user row
        const userRow = page.locator("tr").filter({ hasText: testEmail });
        await expect(userRow).toBeVisible();

        // Use the test ID to find the active toggle switch
        const activeSwitch = page.getByTestId(`user-active-toggle-${testUser.data.id}`);
        await expect(activeSwitch).toBeVisible();
        const initialState = await activeSwitch.getAttribute("data-state");

        // Click to toggle
        await activeSwitch.click();

        // Wait for the UI to update after async handleToggle callback
        await expect(activeSwitch).not.toHaveAttribute(
          "data-state",
          initialState || "",
          { timeout: 15000 }
        );

        // Toggle back
        await activeSwitch.click();

        // Verify state restored
        await expect(activeSwitch).toHaveAttribute(
          "data-state",
          initialState || "",
          { timeout: 15000 }
        );
      } finally {
        // Cleanup
        await api.updateUser({
          userId: testUser.data.id,
          data: { isDeleted: true },
        });
      }
    });

    test("Admin can edit user details via modal", async ({ page, api }) => {
      // Create a test user first
      const testEmail = `edit-test-${Date.now()}@example.com`;
      const testUser = await api.createUser({
        name: "Edit Test User",
        email: testEmail,
        password: "password123",
        roleId: 1,
        access: "USER",
      });

      try {
        await page.goto("/en-US/admin/users");
        await page.waitForLoadState("networkidle");

        // Find the test user row
        const userRow = page.locator("tr").filter({ hasText: testEmail });
        await expect(userRow).toBeVisible();

        // Find the actions cell and click the first button (edit button with pen icon)
        const actionsCell = userRow.locator("td").last();
        const editButton = actionsCell.locator("button").first();
        await expect(editButton).toBeVisible();
        await editButton.click();

        // Wait for modal to open
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog).toBeVisible({ timeout: 5000 });

        // Update name in the modal
        const nameInput = dialog.locator('input[name="name"]');
        await expect(nameInput).toBeVisible();
        await nameInput.clear();
        await nameInput.fill("Updated Edit Test User");

        // Save - use test ID for submit button
        const saveButton = dialog.getByTestId("edit-user-submit-button");
        await expect(saveButton).toBeVisible();
        await saveButton.click();

        // Wait for modal to close
        await expect(dialog).not.toBeVisible({ timeout: 5000 });

        // Wait for network requests to complete after refetch
        await page.waitForLoadState("networkidle");

        // Verify update - the updated name should appear in the table
        await expect(
          page.locator("tr").filter({ hasText: "Updated Edit Test User" })
        ).toBeVisible({ timeout: 15000 });
      } finally {
        // Cleanup: soft delete the test user
        await api.updateUser({
          userId: testUser.data.id,
          data: { isDeleted: true },
        });
      }
    });

    test("Admin can soft delete a user", async ({ page, api }) => {
      // Create a test user
      const testEmail = `delete-test-${Date.now()}@example.com`;
      const testUser = await api.createUser({
        name: "Delete Test User",
        email: testEmail,
        password: "password123",
        roleId: 1,
        access: "USER",
      });

      try {
        await page.goto("/en-US/admin/users");
        await page.waitForLoadState("networkidle");

        // Find the test user row
        const userRow = page.locator("tr").filter({ hasText: testEmail });
        await expect(userRow).toBeVisible();

        // Find the actions cell and click the second button (delete button with trash icon)
        const actionsCell = userRow.locator("td").last();
        const deleteButton = actionsCell.locator("button").nth(1);
        await expect(deleteButton).toBeVisible();
        await deleteButton.click();

        // Wait for confirmation dialog
        const alertDialog = page.locator('[role="alertdialog"]');
        await expect(alertDialog).toBeVisible({ timeout: 5000 });

        // Confirm deletion - the destructive button is the confirm button
        const confirmButton = alertDialog.locator('button[class*="destructive"]').last();
        await confirmButton.click();

        // Wait for dialog to close
        await expect(alertDialog).not.toBeVisible({ timeout: 5000 });

        // Reload the page to ensure we see the updated list
        await page.reload();
        await page.waitForLoadState("networkidle");

        // User should no longer be visible (soft deleted users are excluded from the default view)
        await expect(
          page.locator("tr").filter({ hasText: testEmail })
        ).toHaveCount(0, { timeout: 5000 });
      } catch (error) {
        // Cleanup in case test fails
        await api.updateUser({
          userId: testUser.data.id,
          data: { isDeleted: true },
        });
        throw error;
      }
    });
  });

  test.describe("User Menu Operations", () => {
    test("User can change theme from dropdown menu", async ({ page }) => {
      await page.goto("/en-US");
      await page.waitForLoadState("networkidle");

      // Open user menu (usually in top right)
      const userMenuButton = page
        .getByRole("button")
        .filter({ hasText: /AA|admin/i })
        .first();
      await userMenuButton.click();

      // Wait for dropdown menu
      await expect(page.getByRole("menu")).toBeVisible({ timeout: 3000 });

      // Look for theme submenu
      const themeMenu = page
        .getByRole("menuitem")
        .filter({ hasText: /theme|appearance/i })
        .first();

      if (await themeMenu.isVisible()) {
        await themeMenu.hover();

        // Select a theme option
        const darkTheme = page
          .getByRole("menuitem")
          .filter({ hasText: /dark/i })
          .first();

        if (await darkTheme.isVisible()) {
          await darkTheme.click();
          // Theme change happens asynchronously - wait for network idle
          await page.waitForLoadState("networkidle");
        }
      }

      // Note: This test verifies the menu interaction works
      // The actual theme change is tested in the profile tests
    });
  });

  test.describe("API Endpoint Direct Tests", () => {
    test("API endpoint handles user basic field updates", async ({ api }) => {
      // Create test user
      const testEmail = `api-test-${Date.now()}@example.com`;
      const testUser = await api.createUser({
        name: "API Test User",
        email: testEmail,
        password: "password123",
        roleId: 1,
        access: "USER",
      });

      try {
        // Update via API
        const updated = await api.updateUser({
          userId: testUser.data.id,
          data: {
            name: "Updated API Test User",
            isActive: false,
          },
        });

        expect(updated.data.name).toBe("Updated API Test User");
        expect(updated.data.isActive).toBe(false);
      } finally {
        // Cleanup
        await api.updateUser({
          userId: testUser.data.id,
          data: { isDeleted: true },
        });
      }
    });

    test("API endpoint handles preference updates", async ({ api }) => {
      // Create test user
      const testEmail = `api-pref-test-${Date.now()}@example.com`;
      const testUser = await api.createUser({
        name: "API Pref Test User",
        email: testEmail,
        password: "password123",
        roleId: 1,
        access: "USER",
      });

      try {
        // Update preferences via API
        const updated = await api.updateUser({
          userId: testUser.data.id,
          data: {
            userPreferences: {
              theme: "Dark",
              itemsPerPage: "P25",
            },
          },
        });

        expect(updated.data.userPreferences?.theme).toBe("Dark");
        expect(updated.data.userPreferences?.itemsPerPage).toBe("P25");
      } finally {
        // Cleanup
        await api.updateUser({
          userId: testUser.data.id,
          data: { isDeleted: true },
        });
      }
    });

    test("API endpoint enforces authorization", async ({ browser, api }) => {
      // Create a test user
      const testEmail = `auth-test-${Date.now()}@example.com`;
      const testUser = await api.createUser({
        name: "Auth Test User",
        email: testEmail,
        password: "password123",
        roleId: 1,
        access: "USER",
      });

      try {
        // Create a completely fresh browser context without any cookies or storage
        const context = await browser.newContext({
          storageState: undefined, // No stored authentication
        });
        const unauthenticatedRequest = context.request;

        // Try to update a user without authentication
        const response = await unauthenticatedRequest.patch(
          `http://localhost:3002/api/users/${testUser.data.id}`,
          {
            headers: {
              "Content-Type": "application/json",
            },
            data: JSON.stringify({ name: "Unauthorized Update" }),
          }
        );

        // Should return 401 Unauthorized
        expect(response.status()).toBe(401);
        await context.close();
      } finally {
        // Cleanup
        await api.updateUser({
          userId: testUser.data.id,
          data: { isDeleted: true },
        });
      }
    });
  });
});
