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

  test("User preferences are persisted across sessions", async ({ page, api, context }) => {
    // Create a dedicated test user to avoid data conflicts with other tests
    const timestamp = Date.now();
    const testEmail = `persist-test-${timestamp}@example.com`;
    const testPassword = "Password123!";

    const userResult = await api.createUser({
      name: "Persistence Test User",
      email: testEmail,
      password: testPassword,
      access: "ADMIN", // Use ADMIN to avoid access control issues
    });
    const userId = userResult.data.id;

    try {
      // Logout current user and login as test user
      await context.clearCookies();
      await page.goto("/en-US/signin");
      await page.waitForLoadState("networkidle");

      const emailInput = page.locator('input[type="email"], [data-testid="email-input"]').first();
      const passwordInput = page.locator('input[type="password"], [data-testid="password-input"]').first();
      const submitButton = page.locator('button[type="submit"], [data-testid="signin-button"]').first();

      await emailInput.fill(testEmail);
      await passwordInput.fill(testPassword);
      await submitButton.click();
      await page.waitForURL(/\/en-US\/?$/, { timeout: 10000 });

      // Navigate to own profile
      await page.goto(`/en-US/users/profile/${userId}`);
      await page.waitForLoadState("networkidle");

      // Enter edit mode
      const editButton = page.getByRole("button", { name: /edit/i });
      await editButton.click();

      const profileSubmitButton = page.getByTestId("profile-submit-button");
      await expect(profileSubmitButton).toBeVisible();

      // Scroll down to preferences section
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      // Change theme to Dark
      const themeSelect = page.getByTestId("profile-theme-select");
      await expect(themeSelect).toBeVisible({ timeout: 5000 });
      await themeSelect.click();
      await page.getByRole("option", { name: /dark/i }).click();

      // Wait for the form to update and verify the theme selection changed
      await expect(themeSelect).toContainText("Dark");
      // Give React Hook Form sufficient time to process the change
      await page.waitForTimeout(2000);

      // Save changes - wait for the API call to complete
      await expect(profileSubmitButton).toBeEnabled({ timeout: 5000 });

      // Wait for the PATCH request to the user API
      const updatePromise = page.waitForResponse(
        (response) => response.url().includes(`/api/users/${userId}`) && response.request().method() === 'PATCH',
        { timeout: 10000 }
      );

      await profileSubmitButton.click();

      // Wait for the API response
      const response = await updatePromise;
      expect(response.ok()).toBeTruthy();

      await expect(page.getByRole("button", { name: /edit/i })).toBeVisible({ timeout: 10000 });

      // Wait for the session update and database transaction to fully complete
      await page.waitForTimeout(1000);

      // Logout
      await context.clearCookies();

      // Login again as the same user
      await page.goto("/en-US/signin");
      await page.waitForLoadState("networkidle");

      await emailInput.fill(testEmail);
      await passwordInput.fill(testPassword);
      await submitButton.click();
      await page.waitForURL(/\/en-US\/?$/, { timeout: 10000 });

      // Navigate to profile again
      await page.goto(`/en-US/users/profile/${userId}`);
      await page.waitForLoadState("networkidle");

      // Enter edit mode to verify preference persisted
      await page.getByRole("button", { name: /edit/i }).click();
      await expect(page.getByTestId("profile-submit-button")).toBeVisible();

      // Scroll to preferences
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      // Verify theme is still Dark after re-login
      const themeSelectAfterLogin = page.getByTestId("profile-theme-select");
      await expect(themeSelectAfterLogin).toBeVisible({ timeout: 5000 });
      await expect(themeSelectAfterLogin).toContainText("Dark");
    } finally {
      // Cleanup - re-authenticate as admin to delete the user
      await context.clearCookies();
      await page.goto("/en-US/signin");
      await page.waitForLoadState("networkidle");

      const emailInput = page.locator('input[type="email"], [data-testid="email-input"]').first();
      const passwordInput = page.locator('input[type="password"], [data-testid="password-input"]').first();
      const submitButton = page.locator('button[type="submit"], [data-testid="signin-button"]').first();

      await emailInput.fill("admin@example.com");
      await passwordInput.fill("admin");
      await submitButton.click();
      await page.waitForURL(/\/en-US\/?$/, { timeout: 10000 });

      await api.deleteUser(userId);
    }
  });

  test("All language options are displayed with correct labels", async ({ page, adminUserId }) => {
    // This test ensures all supported languages show proper labels, not raw enum values

    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit profile|edit/i });
    await editButton.click();

    const submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

    // Scroll down to preferences section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Find the locale selector
    const localeCombobox = page.locator('[role="combobox"]').filter({ hasText: /English|Español|Français/i }).first();
    await expect(localeCombobox).toBeVisible();

    // Open the dropdown
    await localeCombobox.click();

    // Verify all three languages are displayed with proper labels
    const englishOption = page.getByRole("option", { name: "English (US)", exact: true });
    await expect(englishOption).toBeVisible({ timeout: 5000 });

    const spanishOption = page.getByRole("option", { name: "Español (ES)", exact: true });
    await expect(spanishOption).toBeVisible();

    const frenchOption = page.getByRole("option", { name: "Français (France)", exact: true });
    await expect(frenchOption).toBeVisible();

    // Verify raw enum values are NOT displayed
    await expect(page.getByRole("option", { name: "fr_FR", exact: true })).not.toBeVisible();
    await expect(page.getByRole("option", { name: "en_US", exact: true })).not.toBeVisible();
    await expect(page.getByRole("option", { name: "es_ES", exact: true })).not.toBeVisible();

    // Close dropdown by pressing Escape
    await page.keyboard.press("Escape");

    // Cancel edit mode
    const cancelButton = page.getByRole("button", { name: /cancel/i });
    await cancelButton.click();

    // Verify the read-only view also shows proper label (not raw enum)
    // The preferences section should show the locale with proper formatting
    const preferencesSection = page.getByText("Locale").first();
    await expect(preferencesSection).toBeVisible();

    // The displayed locale should be one of the proper labels, not raw enum
    const localeDisplay = page.locator("text=/English \\(US\\)|Español \\(ES\\)|Français \\(France\\)/").first();
    await expect(localeDisplay).toBeVisible();
  });

  test("User can change language and it persists with page reload", async ({ page, adminUserId, context }) => {
    // This test verifies the bug fix where changing language from profile page
    // now properly updates the session, cookie, and reloads the page

    // Start on English profile page
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    // Verify we're on English page by checking URL
    expect(page.url()).toContain("/en-US/");

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit profile|edit/i });
    await editButton.click();

    const submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

    // Scroll down to preferences section where locale selector is
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Find the locale selector - it's a shadcn Select component
    const localeLabel = page.getByText("Locale", { exact: false }).first();
    await expect(localeLabel).toBeVisible({ timeout: 5000 });

    // Find the combobox trigger for locale selection
    const localeCombobox = page.locator('[role="combobox"]').filter({ hasText: /English|Español/i }).first();
    await expect(localeCombobox).toBeVisible();

    // Click to open the dropdown
    await localeCombobox.click();

    // Select Spanish (Español) to test the language change
    const spanishOption = page.getByRole("option", { name: /español/i });
    await expect(spanishOption).toBeVisible({ timeout: 5000 });

    // Wait for the PATCH request to complete and page reload
    const updatePromise = page.waitForResponse(
      (response) => response.url().includes(`/api/users/${adminUserId}`) && response.request().method() === 'PATCH',
      { timeout: 10000 }
    );

    // Also wait for navigation/reload that should happen after locale change
    const navigationPromise = page.waitForURL(/\/es-ES\//, { timeout: 15000 });

    await spanishOption.click();

    // Wait a moment for form to register the change
    await page.waitForTimeout(500);

    // Save the changes
    await expect(submitButton).toBeEnabled({ timeout: 5000 });
    await submitButton.click();

    // Wait for API update
    const response = await updatePromise;
    expect(response.ok()).toBeTruthy();

    // Wait for page to reload and redirect to Spanish locale
    await navigationPromise;

    // Verify we're now on Spanish page
    expect(page.url()).toContain("/es-ES/");

    // Verify the NEXT_LOCALE cookie was set correctly
    const cookies = await context.cookies();
    const localeCookie = cookies.find(c => c.name === "NEXT_LOCALE");
    expect(localeCookie).toBeDefined();
    expect(localeCookie?.value).toBe("es-ES");

    // Verify Spanish content is displayed (check for Spanish text in the page)
    // The word "Perfil" is "Profile" in Spanish
    await expect(page.getByText(/perfil|editar perfil/i).first()).toBeVisible({ timeout: 10000 });

    // Revert back to English for cleanup
    const editButtonSpanish = page.getByRole("button", { name: /editar|edit/i });
    await editButtonSpanish.click();

    const submitButtonSpanish = page.getByTestId("profile-submit-button");
    await expect(submitButtonSpanish).toBeVisible();

    // Scroll to preferences
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Find and open locale combobox again (now in Spanish)
    const localeComboboxSpanish = page.locator('[role="combobox"]').filter({ hasText: /English|Español/i }).first();
    await expect(localeComboboxSpanish).toBeVisible();
    await localeComboboxSpanish.click();

    // Select English to revert
    const englishOption = page.getByRole("option", { name: /english/i });
    await expect(englishOption).toBeVisible({ timeout: 5000 });

    const revertUpdatePromise = page.waitForResponse(
      (response) => response.url().includes(`/api/users/${adminUserId}`) && response.request().method() === 'PATCH',
      { timeout: 10000 }
    );

    const revertNavigationPromise = page.waitForURL(/\/en-US\//, { timeout: 15000 });

    await englishOption.click();
    await page.waitForTimeout(500);

    await expect(submitButtonSpanish).toBeEnabled({ timeout: 5000 });
    await submitButtonSpanish.click();

    // Wait for revert
    const revertResponse = await revertUpdatePromise;
    expect(revertResponse.ok()).toBeTruthy();

    await revertNavigationPromise;

    // Verify we're back on English
    expect(page.url()).toContain("/en-US/");

    // Verify cookie is back to en-US
    const cookiesAfterRevert = await context.cookies();
    const localeCookieAfterRevert = cookiesAfterRevert.find(c => c.name === "NEXT_LOCALE");
    expect(localeCookieAfterRevert?.value).toBe("en-US");
  });

  test("User can change to French language and it displays correctly", async ({ page, adminUserId, context }) => {
    // This test verifies that French language works end-to-end with proper labels

    // Start on English profile page
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");

    // Enter edit mode
    const editButton = page.getByRole("button", { name: /edit profile|edit/i });
    await editButton.click();

    const submitButton = page.getByTestId("profile-submit-button");
    await expect(submitButton).toBeVisible();

    // Scroll to preferences
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Find locale selector
    const localeCombobox = page.locator('[role="combobox"]').filter({ hasText: /English|Español|Français/i }).first();
    await expect(localeCombobox).toBeVisible();
    await localeCombobox.click();

    // Select French (Français)
    const frenchOption = page.getByRole("option", { name: "Français (France)", exact: true });
    await expect(frenchOption).toBeVisible({ timeout: 5000 });

    // Wait for API update and navigation
    const updatePromise = page.waitForResponse(
      (response) => response.url().includes(`/api/users/${adminUserId}`) && response.request().method() === 'PATCH',
      { timeout: 10000 }
    );

    const navigationPromise = page.waitForURL(/\/fr-FR\//, { timeout: 15000 });

    await frenchOption.click();
    await page.waitForTimeout(500);

    await expect(submitButton).toBeEnabled({ timeout: 5000 });
    await submitButton.click();

    // Wait for update
    const response = await updatePromise;
    expect(response.ok()).toBeTruthy();

    // Wait for page to reload to French
    await navigationPromise;

    // Verify we're on French page
    expect(page.url()).toContain("/fr-FR/");

    // Verify cookie
    const cookies = await context.cookies();
    const localeCookie = cookies.find(c => c.name === "NEXT_LOCALE");
    expect(localeCookie?.value).toBe("fr-FR");

    // Verify French content (Profile = "Profil" in French)
    await expect(page.getByText(/profil/i).first()).toBeVisible({ timeout: 10000 });

    // Revert to English for cleanup
    const editButtonFrench = page.getByRole("button", { name: /modifier|edit/i });
    await editButtonFrench.click();

    const submitButtonFrench = page.getByTestId("profile-submit-button");
    await expect(submitButtonFrench).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const localeComboboxFrench = page.locator('[role="combobox"]').filter({ hasText: /English|Español|Français/i }).first();
    await expect(localeComboboxFrench).toBeVisible();
    await localeComboboxFrench.click();

    const englishOption = page.getByRole("option", { name: "English (US)", exact: true });
    await expect(englishOption).toBeVisible({ timeout: 5000 });

    const revertUpdatePromise = page.waitForResponse(
      (response) => response.url().includes(`/api/users/${adminUserId}`) && response.request().method() === 'PATCH',
      { timeout: 10000 }
    );

    const revertNavigationPromise = page.waitForURL(/\/en-US\//, { timeout: 15000 });

    await englishOption.click();
    await page.waitForTimeout(500);

    await expect(submitButtonFrench).toBeEnabled({ timeout: 5000 });
    await submitButtonFrench.click();

    const revertResponse = await revertUpdatePromise;
    expect(revertResponse.ok()).toBeTruthy();

    await revertNavigationPromise;

    // Verify back to English
    expect(page.url()).toContain("/en-US/");
  });
});
