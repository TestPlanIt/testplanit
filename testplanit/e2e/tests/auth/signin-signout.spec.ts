import { expect, test } from "../../fixtures";
import { SigninPage } from "../../page-objects/signin.page";

/**
 * Sign-in and Sign-out E2E Tests
 *
 * Tests for credential-based authentication:
 * - Valid credentials redirect to home
 * - Invalid credentials show error and stay on signin
 * - Non-existent email shows error
 * - Deactivated user cannot sign in
 * - Sign-out clears session and redirects to signin
 * - Session persists across page refresh
 *
 * NOTE ON RATE LIMITING: The NextAuth credentials provider in this codebase
 * does NOT have rate limiting applied. Rate limiting only applies to SAML routes,
 * programmatic API requests via proxy.ts, and 2FA verify routes. Therefore, no
 * rate-limit test is included here — there is no behavior to trigger or assert.
 */

test.describe("Sign In and Sign Out", () => {
  // Unauthenticated tests: override storageState to empty so we start logged out
  test.describe("Unauthenticated sign-in flows", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("Sign-in with valid credentials redirects to home", async ({
      page,
      api,
    }) => {
      const timestamp = Date.now();
      const testEmail = `signin-valid-${timestamp}@example.com`;
      const testPassword = "TestPassword123!";

      const userResult = await api.createUser({
        name: "SignIn Valid Test",
        email: testEmail,
        password: testPassword,
        access: "USER",
      });
      const userId = userResult.data.id;

      try {
        const signinPage = new SigninPage(page);
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();

        // Wait for redirect away from signin page
        await page.waitForURL(/\/en-US\/?$|\/en-US\/projects|\/en-US\/verify-email/, {
          timeout: 30000,
        });

        expect(page.url()).not.toContain("/signin");
      } finally {
        await api.deleteUser(userId);
      }
    });

    test("Sign-in with invalid password shows error and stays on signin page", async ({
      page,
      api,
    }) => {
      const timestamp = Date.now();
      const testEmail = `signin-invalid-pw-${timestamp}@example.com`;

      const userResult = await api.createUser({
        name: "SignIn Invalid PW Test",
        email: testEmail,
        password: "CorrectPassword123!",
        access: "USER",
      });
      const userId = userResult.data.id;

      try {
        const signinPage = new SigninPage(page);
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, "WrongPassword999!");
        await signinPage.submit();

        // Error message should appear
        await signinPage.verifyErrorMessage();

        // Should remain on signin page
        expect(page.url()).toContain("/signin");
      } finally {
        await api.deleteUser(userId);
      }
    });

    test("Sign-in with non-existent email shows error and stays on signin page", async ({
      page,
    }) => {
      const signinPage = new SigninPage(page);
      await signinPage.goto();
      await signinPage.fillCredentials(
        `nonexistent-${Date.now()}@example.com`,
        "AnyPassword123!"
      );
      await signinPage.submit();

      // Error message should appear
      await signinPage.verifyErrorMessage();

      // Should remain on signin page
      expect(page.url()).toContain("/signin");
    });

    test("Session persists across page refresh", async ({ page, api }) => {
      const timestamp = Date.now();
      const testEmail = `signin-persist-${timestamp}@example.com`;
      const testPassword = "TestPassword123!";

      const userResult = await api.createUser({
        name: "SignIn Persist Test",
        email: testEmail,
        password: testPassword,
        access: "USER",
      });
      const userId = userResult.data.id;

      try {
        const signinPage = new SigninPage(page);
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();

        // Wait for redirect away from signin
        await page.waitForURL(
          /\/en-US\/?$|\/en-US\/verify-email|\/en-US\/projects/,
          { timeout: 30000 }
        );

        const urlBeforeRefresh = page.url();
        expect(urlBeforeRefresh).not.toContain("/signin");

        // Reload and verify we're still authenticated (not redirected to signin)
        await page.reload();
        await page.waitForLoadState("networkidle");

        expect(page.url()).not.toContain("/signin");
      } finally {
        await api.deleteUser(userId);
      }
    });
  });

  // Deactivated user test: uses admin storageState for api.updateUser, but clears
  // page cookies before attempting to sign in, so the browser is unauthenticated.
  test.describe("Deactivated user access", () => {
    test("Deactivated user cannot sign in", async ({ page, api }) => {
      const timestamp = Date.now();
      const testEmail = `signin-inactive-${timestamp}@example.com`;
      const testPassword = "TestPassword123!";

      const userResult = await api.createUser({
        name: "SignIn Inactive Test",
        email: testEmail,
        password: testPassword,
        access: "USER",
      });
      const userId = userResult.data.id;

      try {
        // Deactivate the user (requires admin session in request fixture)
        await api.updateUser({ userId, data: { isActive: false } });

        // Clear browser cookies so we sign in as an unauthenticated user
        await page.context().clearCookies();

        const signinPage = new SigninPage(page);
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();

        // Deactivated users are denied by NextAuth authorize callback
        // Wait for the page to settle
        await page.waitForTimeout(3000);
        const currentUrl = page.url();

        // Either an error is shown on signin, or we were redirected with an error param
        const hasError =
          currentUrl.includes("/signin") || currentUrl.includes("error=");

        expect(hasError).toBe(true);

        // If still on signin page without error= in URL, the error message should be shown
        if (currentUrl.includes("/signin") && !currentUrl.includes("error=")) {
          await signinPage.verifyErrorMessage();
        }
      } finally {
        await api.deleteUser(userId);
      }
    });
  });

  // Authenticated tests: use the default admin storage state
  test.describe("Authenticated sign-out flow", () => {
    test("Sign-out clears session and redirects to signin", async ({ page }) => {
      await page.goto("/en-US/projects");
      await page.waitForLoadState("networkidle");

      // Confirm we're authenticated
      expect(page.url()).not.toContain("/signin");
      expect(page.url()).toContain("/projects");

      // Find user menu button in the header
      const userMenu = page.locator(
        'button[aria-label*="User menu" i], [data-testid="user-menu"], [data-testid="user-avatar"], button:has([data-testid="avatar"])'
      ).first();
      await expect(userMenu).toBeVisible({ timeout: 10000 });
      await userMenu.click();

      // Find sign-out button in the dropdown menu
      const signOutButton = page.locator(
        '[role="menuitem"]:has-text("Sign out"), [role="menuitem"]:has-text("Sign Out"), [role="menuitem"]:has-text("Logout"), [role="menuitem"]:has-text("Log out")'
      ).first();
      await expect(signOutButton).toBeVisible({ timeout: 5000 });
      await signOutButton.click();

      // Wait for redirect to signin page
      await page.waitForURL(/\/signin/, { timeout: 15000 });
      expect(page.url()).toContain("/signin");

      // Verify protected page now redirects to signin
      await page.goto("/en-US/projects");
      await page.waitForURL(/\/signin/, { timeout: 10000 });
      expect(page.url()).toContain("/signin");
    });
  });
});
