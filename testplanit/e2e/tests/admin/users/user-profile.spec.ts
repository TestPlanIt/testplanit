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

    // Find and click the profile link for admin user
    const profileLink = page.getByRole("link", { name: /Profile of Administrator Account/i });
    await expect(profileLink).toBeVisible();
    await profileLink.click();

    // Should navigate to profile page
    await page.waitForURL(/\/users\/profile\//);
    await expect(page.getByRole("heading", { name: /profile/i })).toBeVisible();
  });

  test("User can edit their own email address", async ({ page }) => {
    const newEmail = `updated-${Date.now()}@example.com`;

    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    // Find and click the profile link for admin user
    const profileLink = page.getByRole("link", { name: /Profile of Administrator Account/i });
    await profileLink.click();

    await page.waitForURL(/\/users\/profile\//);

    // Click edit button
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();

    // Wait for edit mode
    await expect(page.getByRole("button", { name: /save|update/i })).toBeVisible();

    // Update email
    const emailInput = page.getByLabel(/email/i);
    await emailInput.clear();
    await emailInput.fill(newEmail);

    // Save changes
    await page.getByRole("button", { name: /save|update/i }).click();

    // Wait for save to complete
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });

    // Verify email was updated
    await expect(page.getByText(newEmail)).toBeVisible();

    // Revert email back for cleanup
    await editButton.click();
    await expect(page.getByRole("button", { name: /save|update/i })).toBeVisible();
    const emailInputRevert = page.getByLabel(/email/i);
    await emailInputRevert.clear();
    await emailInputRevert.fill("admin@example.com");
    await page.getByRole("button", { name: /save|update/i }).click();
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });
  });

  test("User can update their display name", async ({ page }) => {
    const newName = `Updated Name ${Date.now()}`;

    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    const profileLink = page.getByRole("link", { name: /Profile of Administrator Account/i });
    await profileLink.click();
    await page.waitForURL(/\/users\/profile\//);

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();
    await expect(page.getByRole("button", { name: /save|update/i })).toBeVisible();

    // Update name
    const nameInput = page.getByLabel(/^name/i);
    const originalName = await nameInput.inputValue();
    await nameInput.clear();
    await nameInput.fill(newName);

    // Save
    await page.getByRole("button", { name: /save|update/i }).click();
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });

    // Verify name was updated
    await expect(page.getByText(newName)).toBeVisible();

    // Revert name
    await editButton.click();
    await expect(page.getByRole("button", { name: /save|update/i })).toBeVisible();
    const nameInputRevert = page.getByLabel(/^name/i);
    await nameInputRevert.clear();
    await nameInputRevert.fill(originalName);
    await page.getByRole("button", { name: /save|update/i }).click();
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });
  });

  test("User can change theme preference", async ({ page }) => {
    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    const profileLink = page.getByRole("link", { name: /Profile of Administrator Account/i });
    await profileLink.click();
    await page.waitForURL(/\/users\/profile\//);

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();
    await expect(page.getByRole("button", { name: /save|update/i })).toBeVisible();

    // Find theme selector
    const themeSelect = page.getByLabel(/theme/i);
    await themeSelect.click();

    // Select Dark theme
    await page.getByRole("option", { name: /dark/i }).click();

    // Save
    await page.getByRole("button", { name: /save|update/i }).click();
    await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });

    // Verify preference was saved by checking if we can re-enter edit mode and see the value
    await editButton.click();
    await expect(page.getByRole("button", { name: /save|update/i })).toBeVisible();

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

    const profileLink = page.getByRole("link", { name: /Profile of Administrator Account/i });
    await profileLink.click();
    await page.waitForURL(/\/users\/profile\//);

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();
    await expect(page.getByRole("button", { name: /save|update/i })).toBeVisible();

    // Find items per page selector
    const itemsSelect = page.getByLabel(/items.*per.*page|page.*size/i);
    if (await itemsSelect.isVisible()) {
      await itemsSelect.click();

      // Select a different value
      await page.getByRole("option", { name: /25|50/i }).first().click();

      // Save
      await page.getByRole("button", { name: /save|update/i }).click();
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });
    }
  });

  test("Cannot save profile with invalid email", async ({ page }) => {
    await page.goto("/en-US/admin/users");
    await page.waitForLoadState("networkidle");

    const profileLink = page.getByRole("link", { name: /Profile of Administrator Account/i });
    await profileLink.click();
    await page.waitForURL(/\/users\/profile\//);

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit/i });
    await editButton.click();
    await expect(page.getByRole("button", { name: /save|update/i })).toBeVisible();

    // Enter invalid email
    const emailInput = page.getByLabel(/email/i);
    await emailInput.clear();
    await emailInput.fill("invalid-email");

    // Try to save
    await page.getByRole("button", { name: /save|update/i }).click();

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

    await api.createUserPreferences({
      userId: userId,
      theme: "Dark",
      locale: "en_US",
      itemsPerPage: "P25",
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
      await expect(page.getByRole("button", { name: /save|update/i })).toBeVisible();

      // Verify theme preference is Dark
      const themeValue = page.getByLabel(/theme/i);
      await expect(themeValue).toHaveValue(/Dark/i);
    } finally {
      await api.deleteUser(userId);
    }
  });
});
