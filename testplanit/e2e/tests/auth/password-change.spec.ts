import { expect, test } from "../../fixtures";
import { SigninPage } from "../../page-objects/signin.page";

const TEST_EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN || "example.com";

/**
 * Password Change E2E Tests
 *
 * Tests for changing user passwords via the profile page UI and API,
 * including session persistence after password change and rejection of
 * wrong current passwords.
 */
test.describe("Password Change", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Change password successfully via profile page UI", async ({
    page,
    api,
    baseURL,
  }) => {
    const timestamp = Date.now();
    const testEmail = `pw-change-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const originalPassword = "Password123!";
    const newPassword = "NewPassword456!";

    const userResult = await api.createUser({
      name: `Password Change User ${timestamp}`,
      email: testEmail,
      password: originalPassword,
    });
    const userId = userResult.data.id;

    try {
      const signinPage = new SigninPage(page);

      // Sign in as the test user
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, originalPassword);
      await signinPage.submit();
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });

      // Navigate to user profile page
      await page.goto(`${baseURL}/en-US/users/profile/${userId}`);
      await page.waitForLoadState("networkidle");

      // Find and click the Change Password button (it's a destructive variant button)
      // The button text is "Change Password" from the ChangePasswordModal component
      const changePasswordButton = page
        .getByRole("button", { name: /^change password$/i })
        .first();
      await expect(changePasswordButton).toBeVisible({ timeout: 10000 });
      await changePasswordButton.click();

      // The ChangePasswordModal dialog opens (Radix UI Dialog with role="dialog")
      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Fill in current password
      const currentPasswordInput = dialog.locator("#currentPassword");
      await expect(currentPasswordInput).toBeVisible({ timeout: 5000 });
      await currentPasswordInput.fill(originalPassword);

      // Fill in new password
      const newPasswordInput = dialog.locator("#newPassword");
      await newPasswordInput.fill(newPassword);

      // Fill in confirm password
      const confirmPasswordInput = dialog.locator("#confirmPassword");
      await confirmPasswordInput.fill(newPassword);

      // Submit the form
      await dialog.getByRole("button", { name: /change.*password|save|submit/i }).first().click();

      // Assert success: dialog closes or success toast appears
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      // Sign out
      await page.goto(`${baseURL}/api/auth/signout`);
      const signoutButton = page.getByRole("button", { name: /sign out/i });
      if (await signoutButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await signoutButton.click();
      }

      // Sign in with the NEW password
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, newPassword);
      await signinPage.submit();

      // Assert successful login with new password
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });
      expect(page.url()).toContain("/en-US");
    } finally {
      await api.deleteUser(userId);
    }
  });

  test("Session persists after password change via API", async ({
    page,
    api,
  }) => {
    const timestamp = Date.now();
    const testEmail = `pw-session-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const originalPassword = "Password123!";
    const newPassword = "ChangedPassword789!";

    const userResult = await api.createUser({
      name: `Session Persist User ${timestamp}`,
      email: testEmail,
      password: originalPassword,
    });
    const userId = userResult.data.id;

    try {
      const signinPage = new SigninPage(page);

      // Sign in as the test user
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, originalPassword);
      await signinPage.submit();
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });

      // Change password via the API using the browser's authenticated context
      // Use page.evaluate to call fetch from within the browser page (shares session cookies)
      const changeResult = await page.evaluate(
        async ({ userId, currentPassword, newPassword }) => {
          const res = await fetch(`/api/users/${userId}/change-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword, newPassword }),
          });
          return { ok: res.ok, status: res.status, data: await res.json() };
        },
        { userId, currentPassword: originalPassword, newPassword }
      );
      expect(changeResult.ok).toBeTruthy();
      expect(changeResult.data.message).toBeTruthy();

      // Reload the page
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Assert still authenticated (not redirected to signin)
      expect(page.url()).not.toContain("/signin");
    } finally {
      await api.deleteUser(userId);
    }
  });

  test("Wrong current password is rejected", async ({
    page,
    api,
    baseURL,
  }) => {
    const timestamp = Date.now();
    const testEmail = `pw-wrong-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const correctPassword = "Password123!";

    const userResult = await api.createUser({
      name: `Wrong Password User ${timestamp}`,
      email: testEmail,
      password: correctPassword,
    });
    const userId = userResult.data.id;

    try {
      const signinPage = new SigninPage(page);

      // Sign in as the test user
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, correctPassword);
      await signinPage.submit();
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });

      // Navigate to user profile page
      await page.goto(`${baseURL}/en-US/users/profile/${userId}`);
      await page.waitForLoadState("networkidle");

      // Open the Change Password modal
      const changePasswordButton = page
        .getByRole("button", { name: /^change password$/i })
        .first();
      await expect(changePasswordButton).toBeVisible({ timeout: 10000 });
      await changePasswordButton.click();

      const dialog = page.locator('[role="dialog"]').first();
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Enter WRONG current password
      const currentPasswordInput = dialog.locator("#currentPassword");
      await currentPasswordInput.fill("WrongPassword999!");

      const newPasswordInput = dialog.locator("#newPassword");
      await newPasswordInput.fill("NewPassword456!");

      const confirmPasswordInput = dialog.locator("#confirmPassword");
      await confirmPasswordInput.fill("NewPassword456!");

      // Submit
      await dialog.getByRole("button", { name: /change.*password|save|submit/i }).first().click();

      // Assert error message is visible in the dialog
      await expect(
        dialog
          .getByText(/invalid.*password|incorrect.*password|wrong.*password|current.*password/i)
          .first()
      ).toBeVisible({ timeout: 10000 });

      // Dialog should still be open
      await expect(dialog).toBeVisible({ timeout: 2000 });
    } finally {
      await api.deleteUser(userId);
    }
  });
});
