import { expect, test } from "../../fixtures";
import { SigninPage } from "../../page-objects/signin.page";

const TEST_EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN || "example.com";
// Matches global-setup.ts seeded admin.
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin";

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

      await test.step("Sign in as the test user", async () => {
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, originalPassword);
        await signinPage.submit();
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });
      });

      const dialog = page.locator('[role="dialog"]').first();

      await test.step("Open the Change Password modal from the profile page", async () => {
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
        await expect(dialog).toBeVisible({ timeout: 10000 });
      });

      await test.step("Fill in the password fields and submit", async () => {
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
        await dialog
          .getByRole("button", { name: /change.*password|save|submit/i })
          .first()
          .click();

        // Assert success: dialog closes or success toast appears
        await expect(dialog).not.toBeVisible({ timeout: 10000 });
      });

      await test.step("Sign out", async () => {
        await page.goto(`${baseURL}/api/auth/signout`);
        const signoutButton = page.getByRole("button", { name: /sign out/i });
        if (
          await signoutButton.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          await signoutButton.click();
        }
      });

      await test.step("Sign in with the new password and confirm access", async () => {
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, newPassword);
        await signinPage.submit();

        // Assert successful login with new password
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });
        expect(page.url()).toContain("/en-US");
      });
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

      await test.step("Sign in as the test user", async () => {
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, originalPassword);
        await signinPage.submit();
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });
      });

      await test.step("Change password via the API in the authenticated session", async () => {
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
      });

      await test.step("Reload and confirm the session still persists", async () => {
        // Reload the page
        await page.reload();
        await page.waitForLoadState("networkidle");

        // Assert still authenticated (not redirected to signin)
        expect(page.url()).not.toContain("/signin");
      });
    } finally {
      await api.deleteUser(userId);
    }
  });

  test("Wrong current password is rejected", async ({ page, api, baseURL }) => {
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

      await test.step("Sign in as the test user", async () => {
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, correctPassword);
        await signinPage.submit();
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });
      });

      const dialog = page.locator('[role="dialog"]').first();

      await test.step("Open the Change Password modal from the profile page", async () => {
        // Navigate to user profile page
        await page.goto(`${baseURL}/en-US/users/profile/${userId}`);
        await page.waitForLoadState("networkidle");

        // Open the Change Password modal
        const changePasswordButton = page
          .getByRole("button", { name: /^change password$/i })
          .first();
        await expect(changePasswordButton).toBeVisible({ timeout: 10000 });
        await changePasswordButton.click();

        await expect(dialog).toBeVisible({ timeout: 10000 });
      });

      await test.step("Submit the form with a wrong current password", async () => {
        // Enter WRONG current password
        const currentPasswordInput = dialog.locator("#currentPassword");
        await currentPasswordInput.fill("WrongPassword999!");

        const newPasswordInput = dialog.locator("#newPassword");
        await newPasswordInput.fill("NewPassword456!");

        const confirmPasswordInput = dialog.locator("#confirmPassword");
        await confirmPasswordInput.fill("NewPassword456!");

        // Submit
        await dialog
          .getByRole("button", { name: /change.*password|save|submit/i })
          .first()
          .click();
      });

      await test.step("Verify the error is shown and the dialog stays open", async () => {
        // Assert error message is visible in the dialog
        await expect(
          dialog
            .getByText(
              /invalid.*password|incorrect.*password|wrong.*password|current.*password/i
            )
            .first()
        ).toBeVisible({ timeout: 10000 });

        // Dialog should still be open
        await expect(dialog).toBeVisible({ timeout: 2000 });
      });
    } finally {
      await api.deleteUser(userId);
    }
  });

  test("Server-side policy violation is displayed as localized checklist text (#227)", async ({
    page,
    api,
    baseURL,
  }) => {
    // Proves the rule → translation wiring introduced in #227. Before the
    // fix, the server emitted hardcoded English sentences like
    // "Password must be at least 12 characters". After the fix, the server
    // emits { rule: "minLength", params: { count: 12 } } and the client
    // renders the translated `passwordStrength.minLength` key, which in
    // en-US is "At least 12 characters" — no "Password must be" prefix.
    //
    // We drive this through the force-change-password flow because
    // ChangePasswordModal has a client-side min-length pre-check that would
    // short-circuit before the server policy ever runs. force-change-password
    // has no such pre-check, so a too-short password reaches the server.

    const timestamp = Date.now();
    const testEmail = `pw-policy-loc-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const originalPassword = "LongEnoughPassword123!";

    // Read the tenant's current minPasswordLength so the assertion adapts to
    // whatever the seeded policy is. RegistrationSettings is publicly
    // readable (@@allow('read', true) in schema.zmodel).
    const settingsRes = await page.request.get(
      `${baseURL}/api/model/registrationSettings/findFirst`,
      {
        params: {
          q: JSON.stringify({ select: { minPasswordLength: true } }),
        },
      }
    );
    expect(settingsRes.ok()).toBeTruthy();
    const minPasswordLength =
      (await settingsRes.json()).data?.minPasswordLength ?? 12;

    const userResult = await api.createUser({
      name: `Policy Localization User ${timestamp}`,
      email: testEmail,
      password: originalPassword,
    });
    const userId = userResult.data.id;

    try {
      const signinPage = new SigninPage(page);

      await test.step("Sign in as admin and flag the user for forced password change", async () => {
        // Admin sets mustChangePassword on the test user so the next signin
        // routes to /auth/force-change-password.
        await signinPage.goto();
        await signinPage.fillCredentials(ADMIN_EMAIL, ADMIN_PASSWORD);
        await signinPage.submit();
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });

        const forceRes = await page.request.post(
          `${baseURL}/api/admin/users/${userId}/force-change-password`
        );
        expect(forceRes.ok()).toBeTruthy();
      });

      await test.step("Sign in as the test user and reach the force-change-password screen", async () => {
        // Swap to the test user.
        await page.context().clearCookies();
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, originalPassword);
        await signinPage.submit();
        await page.waitForURL(
          (url) => url.pathname.includes("/auth/force-change-password"),
          { timeout: 30000 }
        );
      });

      await test.step("Submit a too-short password to trigger the server policy", async () => {
        // Passes client "passwords match" + "non-empty" checks; fails server
        // minPasswordLength. The two-rule stuff (uppercase/numbers/etc.) would
        // need a RegistrationSettings mutation and parallel-test risk, so we
        // stick to minLength which is always enforced.
        const tooShort = "a".repeat(Math.max(1, minPasswordLength - 1));
        await page.locator("#newPassword").fill(tooShort);
        await page.locator("#confirmPassword").fill(tooShort);

        await page
          .getByRole("button", { name: /change password/i })
          .first()
          .click();
      });

      await test.step("Verify the violation renders as localized checklist text", async () => {
        // The error alert is `role="alert"` — added alongside #227 so tests can
        // scope to it without relying on the strength indicator elsewhere on
        // the page (which also renders "At least N characters" as a checklist
        // item). Exact-match ensures we fail if the server regresses to the
        // old "Password must be at least N characters" English string.
        const errorAlert = page.getByRole("alert").first();
        await expect(errorAlert).toBeVisible({ timeout: 10000 });
        await expect(errorAlert.locator("p").first()).toHaveText(
          `At least ${minPasswordLength} characters`
        );
      });
    } finally {
      await api.deleteUser(userId);
    }
  });
});
