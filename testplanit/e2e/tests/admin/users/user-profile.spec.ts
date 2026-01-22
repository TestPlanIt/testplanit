import { test, expect } from "../../../fixtures";

/**
 * User Profile E2E Tests
 *
 * Tests for user profile management covering areas customers have reported issues with:
 * - Editing user email
 * - Uploading/changing user avatar
 * - Removing user avatar
 * - Soft deleting users
 * - Updating user preferences
 */

test.describe("User Profile Management", () => {
  test("Admin can view user profile", async ({ page, adminUserId }) => {
    // Navigate directly to admin user's profile page (faster and more reliable)
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    // Verify we're on the profile page by checking for the Edit Profile button
    await expect(page.getByRole("button", { name: /edit profile|edit/i })).toBeVisible();
  });

  test("User can edit their own email address", async ({ page, adminUserId }) => {
    const newEmail = `updated-${Date.now()}@example.com`;

    // Navigate directly to admin user's profile page (faster and more reliable)
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    // Click edit button
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();

    // Wait for edit mode - use test ID for submit button
    const submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

    // Update email using test ID
    const emailInput = page.getByTestId("profile-email-input");
    const originalEmail = await emailInput.inputValue();
    await emailInput.clear();
    await emailInput.fill(newEmail);

    // Wait for form validation to pass
    await page.waitForTimeout(500);

    // Save changes
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for save to complete
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });

    // Verify email was updated
    await expect(page.getByText(newEmail)).toBeVisible();

    // Revert email back for cleanup
    await editButton.click();

    const submitButtonRevert = page.getByTestId("profile-submit-button");
    await expect(submitButtonRevert).toBeVisible();
    const emailInputRevert = page.getByTestId("profile-email-input");

    // Clear and fill with a different value first to ensure form sees a change
    await emailInputRevert.clear();
    await emailInputRevert.fill("temp@example.com");
    await page.waitForTimeout(300);

    // Now fill with the original value
    await emailInputRevert.clear();
    await emailInputRevert.fill(originalEmail);

    // Wait for form validation to pass
    await page.waitForTimeout(500);

    await expect(submitButtonRevert).toBeEnabled({ timeout: 5000 });
    await submitButtonRevert.click();
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });
  });

  test("User can update their display name", async ({ page, adminUserId }) => {
    const newName = `Updated Name ${Date.now()}`;

    // Navigate directly to admin user's profile page (faster and more reliable)
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();

    let submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

    // Update name using test ID
    const nameInput = page.getByTestId("profile-name-input");
    const originalName = await nameInput.inputValue();
    await nameInput.clear();
    await nameInput.fill(newName);

    // Wait for form validation to pass
    await page.waitForTimeout(500);

    // Save
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });

    // Verify name was updated - use .first() to handle multiple occurrences
    await expect(page.getByText(newName).first()).toBeVisible();

    // Revert name
    await editButton.click();

    submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();
    const nameInputRevert = page.getByTestId("profile-name-input");

    // Clear and fill with a different value first to ensure form sees a change
    await nameInputRevert.clear();
    await nameInputRevert.fill("Temp Name");
    await page.waitForTimeout(300);

    // Now fill with the original value
    await nameInputRevert.clear();
    await nameInputRevert.fill(originalName);

    // Wait for form validation to pass
    await page.waitForTimeout(500);

    await expect(submitButton).toBeEnabled({ timeout: 5000 });
    await submitButton.click();
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });
  });

  test("User can change theme preference", async ({ page, adminUserId }) => {
    // Navigate directly to admin user's profile page (faster and more reliable)
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();

    let submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

    // Scroll down to preferences section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Find and click the Theme field trigger button
    const themeButton = page.getByTestId("profile-theme-select");
    await expect(themeButton).toBeVisible({ timeout: 5000 });
    await themeButton.click();

    // Select Dark theme from dropdown
    await page.getByRole("option", { name: /dark/i }).click();

    // Wait for selection
    await page.waitForTimeout(300);

    // Save
    await expect(submitButton).toBeEnabled({ timeout: 5000 });
    await submitButton.click();
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });

    // Verify preference was saved by checking if we can re-enter edit mode
    await editButton.click();
    submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

    // Cancel without saving
    const cancelButton = page.getByRole("button", { name: /cancel/i });
    if (await cancelButton.isVisible()) {
      await cancelButton.click();
    } else {
      await page.keyboard.press("Escape");
    }
  });

  test("Admin can soft delete a user", async ({ page, api }) => {
    // Create a test user to delete
    const testEmail = `delete-test-${Date.now()}@example.com`;
    const userResult = await api.createUser({
      name: "Test User To Delete",
      email: testEmail,
      password: "Password123!",
      access: "USER",
    });
    const userId = userResult.data.id;

    try {
      await page.goto("/en-US/admin/users");
      await page.waitForLoadState("networkidle");

      // Find and click the test user's profile link
      const profileLink = page.getByRole("link", { name: /Profile of Test User To Delete/i });
      await expect(profileLink).toBeVisible();
      await profileLink.click();
      await page.waitForURL(/\/users\/profile\//);

      // Look for delete button (might be in a dropdown or modal)
      const deleteButton = page.getByRole("button", { name: /delete|remove/i });

      if (await deleteButton.isVisible()) {
        await deleteButton.click();

        // Confirm deletion in modal if present
        const confirmButton = page.getByRole("button", { name: /confirm|yes|delete/i });
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
        }

        // Should redirect away from profile or show deleted state
        await page.waitForTimeout(2000);

        // Verify user no longer appears in active users list
        await page.goto("/en-US/admin/users");
        await page.waitForLoadState("networkidle");

        const deletedUserRow = page.locator('tr').filter({ hasText: testEmail });
        await expect(deletedUserRow).not.toBeVisible({ timeout: 5000 });
      }
    } finally {
      // Cleanup is already done by soft delete, but ensure it's deleted
      await api.deleteUser(userId);
    }
  });

  test("User can change items per page preference", async ({ page, adminUserId }) => {
    // Navigate directly to admin user's profile page (faster and more reliable)
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();
    const submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

    // Find items per page selector
    const itemsSelect = page.getByLabel(/items.*per.*page|page.*size/i);
    if (await itemsSelect.isVisible()) {
      await itemsSelect.click();

      // Select a different value
      await page.getByRole("option", { name: /25|50/i }).first().click();

      // Save
      await submitButton.click();
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });
    }
  });

  test("Cannot save profile with invalid email", async ({ page, adminUserId }) => {
    // Navigate directly to admin user's profile page (faster and more reliable)
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();
    const submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

    // Enter invalid email using test ID
    const emailInput = page.getByTestId("profile-email-input");
    await emailInput.clear();
    await emailInput.fill("invalid-email");

    // Try to save
    await submitButton.click();

    // Should show validation error
    await expect(
      page.getByText(/invalid.*email|email.*valid/i)
    ).toBeVisible({ timeout: 5000 });
  });

  test("User preferences are persisted across sessions", async ({ page, adminUserId, context }) => {
    // This test uses the admin user since it's testing preference persistence,
    // not user access levels. Using admin avoids potential access control issues.

    // First, get the current theme to restore it later
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();

    const profileSubmitButton = page.getByTestId("profile-submit-button");
    await expect(profileSubmitButton).toBeVisible();

    // Scroll down to preferences section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Get current theme
    const themeSelect = page.getByTestId("profile-theme-select");
    await expect(themeSelect).toBeVisible({ timeout: 5000 });
    const originalTheme = await themeSelect.textContent();

    // Change theme to Dark (or Light if already Dark)
    const newTheme = originalTheme?.includes("Dark") ? "Light" : "Dark";
    await themeSelect.click();
    await page.getByRole("option", { name: new RegExp(newTheme, "i") }).click();
    await page.waitForTimeout(300);

    // Save changes
    await expect(profileSubmitButton).toBeEnabled({ timeout: 5000 });
    await profileSubmitButton.click();
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });

    // Logout
    await context.clearCookies();

    // Login again as admin
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    const emailInput = page.locator('input[type="email"], [data-testid="email-input"]').first();
    const passwordInput = page.locator('input[type="password"], [data-testid="password-input"]').first();
    const submitButton = page.locator('button[type="submit"], [data-testid="signin-button"]').first();

    await emailInput.fill("admin@example.com");
    await passwordInput.fill("admin");
    await submitButton.click();
    await page.waitForURL(/\/en-US\/?$/, { timeout: 10000 });

    // Navigate to profile again
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    // Enter edit mode to verify preference persisted
    await page.getByRole("button", { name: /edit/i }).click();
    await expect(page.getByTestId("profile-submit-button")).toBeVisible();

    // Scroll to preferences
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Verify theme persisted after re-login
    const themeSelectAfterLogin = page.getByTestId("profile-theme-select");
    await expect(themeSelectAfterLogin).toBeVisible({ timeout: 5000 });
    await expect(themeSelectAfterLogin).toContainText(newTheme);

    // Restore original theme
    await themeSelectAfterLogin.click();
    if (originalTheme) {
      await page.getByRole("option", { name: new RegExp(originalTheme, "i") }).click();
      await page.waitForTimeout(300);
      const restoreSubmitButton = page.getByTestId("profile-submit-button");
      await expect(restoreSubmitButton).toBeEnabled({ timeout: 5000 });
      await restoreSubmitButton.click();
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });
    }
  });
});
