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
      const signinPage = new SigninPage(page);

      let userId: string | undefined;
      await test.step("Create an active user", async () => {
        const userResult = await api.createUser({
          name: "SignIn Valid Test",
          email: testEmail,
          password: testPassword,
          access: "USER",
        });
        userId = userResult.data.id;
      });

      try {
        await test.step("Sign in with valid credentials", async () => {
          await signinPage.goto();
          await signinPage.fillCredentials(testEmail, testPassword);
          await signinPage.submit();
        });

        await test.step("Verify redirect away from the sign-in page", async () => {
          await page.waitForURL(
            /\/en-US\/?$|\/en-US\/projects|\/en-US\/verify-email/,
            {
              timeout: 30000,
            }
          );
          expect(page.url()).not.toContain("/signin");
        });
      } finally {
        if (userId) await api.deleteUser(userId);
      }
    });

    test("Sign-in with invalid password shows error and stays on signin page", async ({
      page,
      api,
    }) => {
      const timestamp = Date.now();
      const testEmail = `signin-invalid-pw-${timestamp}@example.com`;
      const signinPage = new SigninPage(page);

      let userId: string | undefined;
      await test.step("Create a user with a known password", async () => {
        const userResult = await api.createUser({
          name: "SignIn Invalid PW Test",
          email: testEmail,
          password: "CorrectPassword123!",
          access: "USER",
        });
        userId = userResult.data.id;
      });

      try {
        await test.step("Attempt sign-in with the wrong password", async () => {
          await signinPage.goto();
          await signinPage.fillCredentials(testEmail, "WrongPassword999!");
          await signinPage.submit();
        });

        await test.step("Verify an error shows and we stay on the sign-in page", async () => {
          await signinPage.verifyErrorMessage();
          expect(page.url()).toContain("/signin");
        });
      } finally {
        if (userId) await api.deleteUser(userId);
      }
    });

    test("Sign-in with non-existent email shows error and stays on signin page", async ({
      page,
    }) => {
      const signinPage = new SigninPage(page);

      await test.step("Attempt sign-in with a non-existent email", async () => {
        await signinPage.goto();
        await signinPage.fillCredentials(
          `nonexistent-${Date.now()}@example.com`,
          "AnyPassword123!"
        );
        await signinPage.submit();
      });

      await test.step("Verify an error shows and we stay on the sign-in page", async () => {
        await signinPage.verifyErrorMessage();
        expect(page.url()).toContain("/signin");
      });
    });

    test("Session persists across page refresh", async ({ page, api }) => {
      const timestamp = Date.now();
      const testEmail = `signin-persist-${timestamp}@example.com`;
      const testPassword = "TestPassword123!";
      const signinPage = new SigninPage(page);

      let userId: string | undefined;
      await test.step("Create an active user", async () => {
        const userResult = await api.createUser({
          name: "SignIn Persist Test",
          email: testEmail,
          password: testPassword,
          access: "USER",
        });
        userId = userResult.data.id;
      });

      try {
        await test.step("Sign in with valid credentials", async () => {
          await signinPage.goto();
          await signinPage.fillCredentials(testEmail, testPassword);
          await signinPage.submit();
        });

        await test.step("Verify we land on an authenticated page", async () => {
          await page.waitForURL(
            /\/en-US\/?$|\/en-US\/verify-email|\/en-US\/projects/,
            { timeout: 30000 }
          );
          expect(page.url()).not.toContain("/signin");
        });

        await test.step("Reload and verify the session persists", async () => {
          await page.reload();
          await page.waitForLoadState("networkidle");
          expect(page.url()).not.toContain("/signin");
        });
      } finally {
        if (userId) await api.deleteUser(userId);
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
      const signinPage = new SigninPage(page);

      let userId: string | undefined;
      await test.step("Create an active user", async () => {
        const userResult = await api.createUser({
          name: "SignIn Inactive Test",
          email: testEmail,
          password: testPassword,
          access: "USER",
        });
        userId = userResult.data.id;
      });

      try {
        await test.step("Deactivate the user", async () => {
          // Requires an admin session in the request fixture.
          await api.updateUser({ userId: userId!, data: { isActive: false } });
        });

        await test.step("Sign in as the deactivated user from a clean session", async () => {
          // Clear browser cookies so we sign in as an unauthenticated user.
          await page.context().clearCookies();
          await signinPage.goto();
          await signinPage.fillCredentials(testEmail, testPassword);
          await signinPage.submit();
        });

        await test.step("Verify sign-in is denied", async () => {
          // Deactivated users are denied by the NextAuth authorize callback;
          // wait for the page to settle before inspecting the outcome.
          await page.waitForTimeout(3000);
          const currentUrl = page.url();

          // Either an error is shown on signin, or we were redirected with an error param.
          const hasError =
            currentUrl.includes("/signin") || currentUrl.includes("error=");
          expect(hasError).toBe(true);

          // If still on signin without error= in the URL, the error message should be shown.
          if (
            currentUrl.includes("/signin") &&
            !currentUrl.includes("error=")
          ) {
            await signinPage.verifyErrorMessage();
          }
        });
      } finally {
        if (userId) await api.deleteUser(userId);
      }
    });
  });

  // Authenticated tests: use the default admin storage state
  test.describe("Authenticated sign-out flow", () => {
    test("Sign-out clears session and redirects to signin", async ({
      page,
    }) => {
      await test.step("Open an authenticated page and confirm we're signed in", async () => {
        await page.goto("/en-US/projects");
        await page.waitForLoadState("networkidle");
        expect(page.url()).not.toContain("/signin");
        expect(page.url()).toContain("/projects");
      });

      await test.step("Open the user menu", async () => {
        const userMenu = page
          .locator(
            'button[aria-label*="User menu" i], [data-testid="user-menu"], [data-testid="user-avatar"], button:has([data-testid="avatar"])'
          )
          .first();
        await expect(userMenu).toBeVisible({ timeout: 10000 });
        await userMenu.click();
      });

      await test.step("Click sign out", async () => {
        const signOutButton = page
          .locator(
            '[role="menuitem"]:has-text("Sign out"), [role="menuitem"]:has-text("Sign Out"), [role="menuitem"]:has-text("Logout"), [role="menuitem"]:has-text("Log out")'
          )
          .first();
        await expect(signOutButton).toBeVisible({ timeout: 5000 });
        await signOutButton.click();
      });

      await test.step("Verify redirect to the sign-in page", async () => {
        await page.waitForURL(/\/signin/, { timeout: 15000 });
        expect(page.url()).toContain("/signin");
      });

      await test.step("Verify protected pages now redirect to sign-in", async () => {
        await page.goto("/en-US/projects");
        await page.waitForURL(/\/signin/, { timeout: 10000 });
        expect(page.url()).toContain("/signin");
      });
    });
  });
});
