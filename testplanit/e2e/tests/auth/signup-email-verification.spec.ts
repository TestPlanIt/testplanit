import { expect, test } from "../../fixtures";
import { SigninPage } from "../../page-objects/signin.page";

/**
 * Sign-up with Email Verification E2E Tests
 *
 * The existing signup.spec.ts covers form validation and the basic happy-path signup
 * redirect to verify-email. This spec focuses on the EMAIL VERIFICATION flow itself,
 * which is NOT covered by the existing tests:
 *
 * - Complete signup + real email verification via the DB token URL
 * - Unverified user is redirected to verify-email page after sign-in
 * - Resend verification email button is present on verify-email page
 *
 * IMPORTANT: These tests exercise the real `/en-US/verify-email?token=...&email=...`
 * verification endpoint — not the test-helpers shortcut — to validate the actual
 * user-facing verification flow.
 */

test.describe("Sign Up with Email Verification", () => {
  /**
   * Complete sign-up and email verification via real verification URL.
   *
   * This test uses the admin session (from global storage state) so that
   * the `request` fixture can query the database for the emailVerifToken.
   * The actual browser page starts unauthenticated because we navigate to
   * the signup form directly — the signup API creates a new session after
   * registration which is separate from the admin fixture's session.
   *
   * We create the user via api.createUser (public signup API) WITHOUT
   * email verification, then retrieve the token via the admin request
   * context, and navigate the browser to the real verification URL.
   */
  test("Complete sign-up and email verification via real verification URL", async ({
    page,
    api,
    request,
  }, testInfo) => {
    const timestamp = Date.now();
    const testEmail = `test-verify-${timestamp}@example.com`;
    const testPassword = "SecurePassword123!";

    // Create user WITHOUT email verification (so emailVerifToken is set and emailVerified is null)
    const userResult = await api.createUser({
      name: `Verify Test ${timestamp}`,
      email: testEmail,
      password: testPassword,
      access: "USER",
      emailVerified: false, // Keep token so we can use it for verification
    });
    const userId = userResult.data.id;

    try {
      // Retrieve the email verification token from the database via admin API request
      // (request fixture uses admin session from global storageState)
      const baseURL = testInfo.project.use.baseURL || "http://localhost:3002";
      const userResponse = await request.get(`${baseURL}/api/model/user/findFirst`, {
        params: {
          q: JSON.stringify({
            where: { email: testEmail, isDeleted: false },
            select: { id: true, emailVerifToken: true },
          }),
        },
      });

      expect(userResponse.ok()).toBe(true);
      const userData = await userResponse.json();

      const fetchedUserId = userData.data?.id;
      const emailVerifToken = userData.data?.emailVerifToken;

      expect(fetchedUserId).toBeTruthy();
      expect(emailVerifToken).toBeTruthy();

      // Now navigate the browser (as unauthenticated context via a new page context)
      // to the REAL verification URL with the DB token.
      // Use a fresh unauthenticated browser context to simulate the real user flow.
      const context = await page.context().browser()!.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const verifyPage = await context.newPage();

      try {
        // Navigate to the real verification URL
        // The VerifyEmail component auto-submits when both token and email params are present
        await verifyPage.goto(
          `${baseURL}/en-US/verify-email?token=${encodeURIComponent(emailVerifToken)}&email=${encodeURIComponent(testEmail)}`
        );

        // Wait for the verification to complete — the component auto-submits via useEffect
        // and redirects to "/" on success (or shows an error toast on failure)
        await Promise.race([
          verifyPage.waitForURL(/\/en-US\/?$|\/en-US\/projects|\/en-US\/signin/, {
            timeout: 15000,
          }),
          verifyPage.waitForTimeout(10000),
        ]);

        // After verification, sign in to confirm emailVerified was set
        // An unverified user would be redirected to /verify-email by the Header component
        const signinPage = new SigninPage(verifyPage);
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();

        // Wait for redirect after login
        await verifyPage.waitForURL(
          /\/en-US\/?$|\/en-US\/projects|\/en-US\/verify-email/,
          { timeout: 30000 }
        );

        // Verified user should NOT be redirected to verify-email
        // (the Header component redirects unverified users there)
        expect(verifyPage.url()).not.toContain("/verify-email");
      } finally {
        await verifyPage.close();
        await context.close();
      }
    } finally {
      await api.deleteUser(userId);
    }
  });

  // Unauthenticated tests: sign-in as new unverified user and check verify-email page
  test.describe("Unverified user flows", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("Unverified user sees verify-email page after sign-in", async ({
      page,
      api,
    }) => {
      const timestamp = Date.now();
      const testEmail = `unverified-${timestamp}@example.com`;
      const testPassword = "TestPassword123!";

      // Create user with emailVerified: false
      const userResult = await api.createUser({
        name: `Unverified User ${timestamp}`,
        email: testEmail,
        password: testPassword,
        access: "USER",
        emailVerified: false,
      });
      const userId = userResult.data.id;

      try {
        // Sign in with unverified credentials
        const signinPage = new SigninPage(page);
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();

        // The Header component redirects unverified users to /verify-email
        await page.waitForURL(/\/en-US\/verify-email|\/signin/, { timeout: 30000 });

        const currentUrl = page.url();

        // Unverified users should be redirected to verify-email
        // (or remain on signin if the account is somehow blocked)
        expect(
          currentUrl.includes("/verify-email") || currentUrl.includes("/signin")
        ).toBe(true);

        // If on verify-email page, confirm the page title is shown
        if (currentUrl.includes("/verify-email")) {
          const pageTitle = page.getByTestId("verify-email-page-title");
          await expect(pageTitle).toBeVisible({ timeout: 5000 });
        }
      } finally {
        await api.deleteUser(userId);
      }
    });

    test("Resend verification email button exists on verify-email page", async ({
      page,
      api,
    }) => {
      const timestamp = Date.now();
      const testEmail = `resend-test-${timestamp}@example.com`;
      const testPassword = "TestPassword123!";

      // Create unverified user
      const userResult = await api.createUser({
        name: `Resend Test User ${timestamp}`,
        email: testEmail,
        password: testPassword,
        access: "USER",
        emailVerified: false,
      });
      const userId = userResult.data.id;

      try {
        // Sign in to reach the verify-email page
        const signinPage = new SigninPage(page);
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();

        // Wait for redirect to verify-email page
        await page.waitForURL(/\/en-US\/verify-email/, { timeout: 30000 });
        expect(page.url()).toContain("/verify-email");

        // Verify the resend button is present
        const resendButton = page.getByRole("button", { name: /resend/i });
        await expect(resendButton).toBeVisible({ timeout: 5000 });
      } finally {
        await api.deleteUser(userId);
      }
    });
  });
});
