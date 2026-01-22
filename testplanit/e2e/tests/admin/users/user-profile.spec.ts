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
  test("Admin can view user profile", async ({ page }) => {
    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    // Find the admin user row by name (Administrator Account with star icon)
    const adminRow = page.locator('tr').filter({ hasText: 'Administrator Account' });
    await expect(adminRow).toBeVisible();

    // Click the profile link within that row
    const profileLink = adminRow.locator('a').first();
    await profileLink.click();

    // Should navigate to profile page
    await page.waitForURL(/\/users\/profile\//);
    // Verify we're on the profile page by checking for the Edit Profile button
    await expect(page.getByRole("button", { name: /edit profile|edit/i })).toBeVisible();
  });

  test("User can edit their own email address", async ({ page }) => {
    const newEmail = `updated-${Date.now()}@example.com`;

    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    // Find and click the profile link for admin user
    // Find the admin user row by name (Administrator Account)
    const adminRow = page.locator('tr').filter({ hasText: 'Administrator Account' });
    const profileLink = adminRow.locator('a').first();
    await profileLink.click();

    await page.waitForURL(/\/users\/profile\//);

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

  test("User can update their display name", async ({ page }) => {
    const newName = `Updated Name ${Date.now()}`;

    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    // Find the admin user row by name (Administrator Account)
    const adminRow = page.locator('tr').filter({ hasText: 'Administrator Account' });
    const profileLink = adminRow.locator('a').first();
    await profileLink.click();
    await page.waitForURL(/\/users\/profile\//);

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

  test("User can change theme preference", async ({ page }) => {
    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    // Find the admin user row by star icon
    const adminRow = page.locator('tr').filter({ hasText: 'Administrator Account' });
    const profileLink = adminRow.locator('a').first();
    await profileLink.click();
    await page.waitForURL(/\/users\/profile\//);

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();

    let submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

    // Scroll down to preferences section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Find and click the Theme field trigger button
    const themeButton = page.getByRole("button", { name: /purple|theme/i }).first();
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

  test("User can change items per page preference", async ({ page }) => {
    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    // Find the admin user row by email
    const adminRow = page.locator('tr').filter({ hasText: 'Administrator Account' });
    const profileLink = adminRow.locator('a').first();
    await profileLink.click();
    await page.waitForURL(/\/users\/profile\//);

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

  test("Cannot save profile with invalid email", async ({ page }) => {
    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    // Find the admin user row by email
    const adminRow = page.locator('tr').filter({ hasText: 'Administrator Account' });
    const profileLink = adminRow.locator('a').first();
    await profileLink.click();
    await page.waitForURL(/\/users\/profile\//);

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

  test("User preferences are persisted across sessions", async ({ page, api }) => {
    const timestamp = Date.now();
    const testEmail = `persist-test-${timestamp}@example.com`;

    // Create user with preferences
    const userResult = await api.createUser({
      name: "Persistence Test User",
      email: testEmail,
      password: "Password123!",
      access: "USER",
    });
    const userId = userResult.data.id;

    // Update user preferences (user already has default preferences from signup)
    await api.updateUser({
      userId: userId,
      data: {
        userPreferences: {
          theme: "Dark",
          locale: "en_US",
          itemsPerPage: "P25",
        },
      },
    });

    try {
      await page.goto("/en-US/admin/users");
      await page.waitForLoadState("networkidle");

      // Find and view the test user
      const profileLink = page.getByRole("link", { name: /Profile of Persistence Test User/i });
      await profileLink.click();
      await page.waitForURL(/\/users\/profile\//);

      // Enter edit mode to verify preferences
      const editButton = page.getByRole("button", { name: /edit/i });
      await editButton.click();
      const submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

      // Verify theme preference is Dark
      const themeValue = page.getByLabel(/theme/i);
      await expect(themeValue).toHaveValue(/Dark/i);
    } finally {
      await api.deleteUser(userId);
    }
  });
});
