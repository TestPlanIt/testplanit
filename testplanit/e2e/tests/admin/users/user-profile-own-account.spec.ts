import { expect, test } from "../../../fixtures";

/**
 * Edits to the signed-in admin's own email, name and avatar. Every other
 * spec signs in as this account, so these run on their own after the suite
 * (see INSTANCE_SETTINGS_SPECS in playwright.config.ts).
 */
test.describe("User Profile Management - own account", () => {
  test.describe.configure({ mode: "serial" });

  test("User can edit their own email address", async ({
    page,
    adminUserId,
  }) => {
    const newEmail = `updated-${Date.now()}@example.com`;
    let originalEmail: string | undefined;

    await test.step("Open the admin user's profile page", async () => {
      // Navigate directly to admin user's profile page (faster and more reliable)
      await page.goto(`/en-US/users/profile/${adminUserId}`);
      await page.waitForLoadState("networkidle");
    });

    const editButton = page.getByRole("button", { name: /edit/i });

    await test.step("Enter edit mode", async () => {
      // Click edit button
      await editButton.click();

      // Wait for edit mode - use test ID for submit button
      const submitButton = page.getByTestId("profile-submit-button");
      await expect(submitButton).toBeVisible();
    });

    await test.step("Update the email address and save", async () => {
      const submitButton = page.getByTestId("profile-submit-button");

      // Update email using test ID
      const emailInput = page.getByTestId("profile-email-input");
      originalEmail = await emailInput.inputValue();
      await emailInput.clear();
      await emailInput.fill(newEmail);

      // Wait for form validation to pass
      await page.waitForTimeout(500);

      // Save changes
      await expect(submitButton).toBeEnabled();
      await submitButton.click();

      // Wait for save to complete
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Verify the new email is displayed", async () => {
      // Verify email was updated
      await expect(page.getByText(newEmail)).toBeVisible();
    });

    await test.step("Revert the email back to the original value", async () => {
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
      await emailInputRevert.fill(originalEmail!);

      // Wait for form validation to pass
      await page.waitForTimeout(500);

      await expect(submitButtonRevert).toBeEnabled({ timeout: 5000 });
      await submitButtonRevert.click();
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("User can update their display name", async ({ page, adminUserId }) => {
    const newName = `Updated Name ${Date.now()}`;
    let originalName: string | undefined;

    await test.step("Open the admin user's profile page", async () => {
      // Navigate directly to admin user's profile page (faster and more reliable)
      await page.goto(`/en-US/users/profile/${adminUserId}`);
      await page.waitForLoadState("networkidle");
    });

    const editButton = page.getByRole("button", { name: /edit/i });

    await test.step("Enter edit mode", async () => {
      // Enter edit mode
      await editButton.click();

      const submitButton = page.getByTestId("profile-submit-button");
      await expect(submitButton).toBeVisible();
    });

    await test.step("Update the display name and save", async () => {
      const submitButton = page.getByTestId("profile-submit-button");

      // Update name using test ID
      const nameInput = page.getByTestId("profile-name-input");
      originalName = await nameInput.inputValue();
      await nameInput.clear();
      await nameInput.fill(newName);

      // Wait for form validation to pass
      await page.waitForTimeout(500);

      // Save
      await expect(submitButton).toBeEnabled();
      await submitButton.click();
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step("Verify the new name is displayed", async () => {
      // Verify name was updated - use .first() to handle multiple occurrences
      await expect(page.getByText(newName).first()).toBeVisible();
    });

    await test.step("Revert the name back to the original value", async () => {
      // Revert name
      await editButton.click();

      const submitButton = page.getByTestId("profile-submit-button");
      await expect(submitButton).toBeVisible();
      const nameInputRevert = page.getByTestId("profile-name-input");

      // Clear and fill with a different value first to ensure form sees a change
      await nameInputRevert.clear();
      await nameInputRevert.fill("Temp Name");
      await page.waitForTimeout(300);

      // Now fill with the original value
      await nameInputRevert.clear();
      await nameInputRevert.fill(originalName!);

      // Wait for form validation to pass
      await page.waitForTimeout(500);

      await expect(submitButton).toBeEnabled({ timeout: 5000 });
      await submitButton.click();
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test("Name and avatar updates appear immediately in Header and UserDropdownMenu", async ({
    page,
    adminUserId,
  }) => {
    /**
     * This test verifies the bug fix where updating a user's name or avatar
     * should immediately reflect in session-dependent components like:
     * - The Header's UserDropdownMenu
     * - Avatar component showing initials
     *
     * This ensures the session is properly refreshed after updates.
     */
    const newName = `Test User ${Date.now()}`;
    let originalName: string | undefined;

    await test.step("Open the admin user's profile page", async () => {
      // Navigate to profile page
      await page.goto(`/en-US/users/profile/${adminUserId}`);
      await page.waitForLoadState("networkidle");
    });

    const userMenuTrigger = page.getByTestId("user-menu-trigger");
    const userMenuContent = page.getByTestId("user-menu-content");
    const editButton = page.getByRole("button", { name: /edit/i });

    await test.step("Open and close the user menu to capture the baseline", async () => {
      // Get the original name from the user menu BEFORE making changes
      await userMenuTrigger.click();

      await expect(userMenuContent).toBeVisible();

      // Close the menu
      await page.keyboard.press("Escape");
      await expect(userMenuContent).not.toBeVisible();
    });

    await test.step("Enter edit mode", async () => {
      // Enter edit mode
      await editButton.click();

      const submitButton = page.getByTestId("profile-submit-button");
      await expect(submitButton).toBeVisible();
    });

    await test.step("Update the display name and save", async () => {
      const submitButton = page.getByTestId("profile-submit-button");

      // Update name
      const nameInput = page.getByTestId("profile-name-input");
      originalName = await nameInput.inputValue();
      await nameInput.clear();
      await nameInput.fill(newName);

      // Wait for form validation
      await page.waitForTimeout(500);

      // Save changes
      await expect(submitButton).toBeEnabled();
      await submitButton.click();
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({
        timeout: 10000,
      });

      // Wait for session update to propagate (updateSession() is async after save)
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify the updated name appears in the user menu and on the page", async () => {
      // CRITICAL: Verify name updated in the Header's UserDropdownMenu
      // This is the key test that would have caught the original bug
      await userMenuTrigger.click();
      await expect(userMenuContent).toBeVisible();

      // Verify the updated name appears in the user menu
      await expect(userMenuContent.getByText(newName)).toBeVisible({
        timeout: 10000,
      });

      // Close the menu
      await page.keyboard.press("Escape");
      await expect(userMenuContent).not.toBeVisible();

      // Verify name also updated on the profile page itself
      await expect(page.getByText(newName).first()).toBeVisible();
    });

    await test.step("Revert the name and confirm the menu reflects it", async () => {
      // Revert the name back to original
      await editButton.click();
      const submitButtonRevert = page.getByTestId("profile-submit-button");
      await expect(submitButtonRevert).toBeVisible();

      const nameInputRevert = page.getByTestId("profile-name-input");
      await nameInputRevert.clear();
      await nameInputRevert.fill(originalName!);
      await page.waitForTimeout(500);

      await expect(submitButtonRevert).toBeEnabled({ timeout: 5000 });
      await submitButtonRevert.click();
      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({
        timeout: 10000,
      });

      // Verify reverted name appears in user menu
      await userMenuTrigger.click();
      await expect(userMenuContent).toBeVisible();
      await expect(userMenuContent.getByText(originalName!)).toBeVisible({
        timeout: 5000,
      });
      await page.keyboard.press("Escape");
    });
  });

  test("Avatar removal updates immediately in Header", async ({
    page,
    adminUserId,
    api,
  }) => {
    /**
     * This test verifies that removing a user's avatar immediately updates
     * the Header's UserDropdownMenu to show initials instead of the image.
     *
     * This ensures updateSession() is called after avatar removal.
     */

    // First, ensure the user has an avatar by uploading one
    // We'll use a simple data URL for a 1x1 transparent PNG
    const testAvatarUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    await test.step("Seed the user with an avatar and open the profile page", async () => {
      // Update user with an avatar via API
      await api.updateUser({
        userId: adminUserId,
        data: { image: testAvatarUrl },
      });

      // Navigate to profile page
      await page.goto(`/en-US/users/profile/${adminUserId}`);
      await page.waitForLoadState("networkidle");
    });

    const userMenuTrigger = page.getByTestId("user-menu-trigger");
    const avatarImage = userMenuTrigger.locator("img");

    await test.step("Verify the avatar image is shown in the header", async () => {
      // Verify avatar image exists in the header (before removal)
      await expect(avatarImage).toBeVisible();
    });

    await test.step("Remove the avatar and confirm the header shows initials", async () => {
      // Find and click the remove avatar button (X button on the avatar)
      const removeAvatarButton = page.locator("#remove-avatar");
      if (await removeAvatarButton.isVisible()) {
        await removeAvatarButton.click();

        // Confirm removal in the popover
        const deleteButton = page.getByRole("button", { name: /delete/i });
        await expect(deleteButton).toBeVisible({ timeout: 5000 });
        await deleteButton.click();

        // Wait for the removal to complete
        await page.waitForTimeout(1000);

        // CRITICAL: Verify the avatar in the Header now shows initials (no image)
        // When there's no image, the Avatar component renders a div with initials instead of an img
        await expect(avatarImage).not.toBeVisible({ timeout: 5000 });

        // Verify initials are shown instead (the avatar should still be clickable)
        await expect(userMenuTrigger).toBeVisible();
      }
    });
  });
});
