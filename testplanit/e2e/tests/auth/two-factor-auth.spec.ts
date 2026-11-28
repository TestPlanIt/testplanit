import { expect, test } from "../../fixtures";
import { SigninPage } from "../../page-objects/signin.page";
import { generateTOTP } from "../../utils/totp";

const TEST_EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN || "example.com";

/**
 * Set up 2FA for a user. Requires an active browser session.
 * Returns the TOTP secret and backup codes.
 */
async function setup2FA(
  page: { request: { get: Function; post: Function } },
  baseURL: string
): Promise<{ secret: string; backupCodes: string[] }> {
  // Call the voluntary 2FA setup endpoint with the browser's authenticated context
  const setupResponse = await page.request.get(
    `${baseURL}/api/auth/two-factor/setup`
  );
  if (!setupResponse.ok()) {
    throw new Error(
      `Setup failed: ${setupResponse.status()} ${await setupResponse.text()}`
    );
  }
  const setupData = await setupResponse.json();
  const secret = setupData.secret as string;

  // Generate a TOTP code and enable 2FA
  const totpCode = generateTOTP(secret);
  const enableResponse = await page.request.post(
    `${baseURL}/api/auth/two-factor/enable`,
    {
      data: { token: totpCode },
      headers: { "Content-Type": "application/json" },
    }
  );
  if (!enableResponse.ok()) {
    throw new Error(
      `Enable failed: ${enableResponse.status()} ${await enableResponse.text()}`
    );
  }
  const enableData = await enableResponse.json();
  return { secret, backupCodes: enableData.backupCodes as string[] };
}

test.describe("Two-Factor Authentication", () => {
  // Use an unauthenticated context for all tests in this suite
  test.use({ storageState: { cookies: [], origins: [] } });

  test("2FA voluntary setup and subsequent login with TOTP", async ({
    page,
    api,
    baseURL,
  }) => {
    const timestamp = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const testEmail = `2fa-totp-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const testPassword = "Password123!";

    // Create a test user
    const userResult = await api.createUser({
      name: `2FA TOTP User ${timestamp}`,
      email: testEmail,
      password: testPassword,
    });
    const userId = userResult.data.id;

    try {
      const signinPage = new SigninPage(page);
      let secret: string | undefined;
      let twoFADialog: ReturnType<typeof page.locator> | undefined;

      await test.step("Sign in to establish a session", async () => {
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });
      });

      await test.step("Set up 2FA via the voluntary setup path", async () => {
        const setup = await setup2FA(page, baseURL!);
        secret = setup.secret;
        expect(setup.backupCodes.length).toBeGreaterThan(0);
      });

      await test.step("Sign out and sign in again to trigger the 2FA dialog", async () => {
        // Sign out by clearing cookies (most reliable approach)
        await page.context().clearCookies();

        // Sign in again — should trigger 2FA dialog
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();

        // Wait for the 2FA dialog to appear
        twoFADialog = page.locator('[role="dialog"]').first();
        await expect(twoFADialog).toBeVisible({ timeout: 15000 });
        await expect(
          twoFADialog
            .getByText(/two.factor|two factor|verification code|authenticator/i)
            .first()
        ).toBeVisible({ timeout: 5000 });
      });

      await test.step("Enter a fresh TOTP code and verify successful login", async () => {
        // Generate a fresh TOTP code (must be current time-step)
        const freshTotpCode = generateTOTP(secret!);

        // The input-otp library renders a hidden <input> behind visual slots.
        // Click the OTP input and fill with the 6-digit code.
        const otpInput = twoFADialog!
          .locator(
            'input[inputmode="numeric"], input[autocomplete="one-time-code"]'
          )
          .first();
        await otpInput.click();
        await otpInput.fill(freshTotpCode);

        // The InputOTP triggers onComplete automatically when all 6 digits are entered
        // Wait for redirect to home page
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });
        expect(page.url()).toContain("/en-US");
      });
    } finally {
      await api.deleteUser(userId);
    }
  });

  test("2FA verification with backup code", async ({ page, api, baseURL }) => {
    const timestamp = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const testEmail = `2fa-backup-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const testPassword = "Password123!";

    const userResult = await api.createUser({
      name: `2FA Backup User ${timestamp}`,
      email: testEmail,
      password: testPassword,
    });
    const userId = userResult.data.id;

    try {
      const signinPage = new SigninPage(page);
      let firstBackupCode: string | undefined;
      let twoFADialog: ReturnType<typeof page.locator> | undefined;

      await test.step("Sign in to establish session", async () => {
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });
      });

      await test.step("Set up 2FA and save backup codes", async () => {
        const { backupCodes } = await setup2FA(page, baseURL!);
        expect(backupCodes.length).toBeGreaterThan(0);
        firstBackupCode = backupCodes[0];
      });

      await test.step("Sign out and sign in again to trigger the 2FA dialog", async () => {
        // Sign out by clearing cookies
        await page.context().clearCookies();

        // Sign in again to trigger 2FA
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();

        // Wait for 2FA dialog
        twoFADialog = page.locator('[role="dialog"]').first();
        await expect(twoFADialog).toBeVisible({ timeout: 15000 });
        await expect(
          twoFADialog
            .getByText(/two.factor|two factor|verification code|authenticator/i)
            .first()
        ).toBeVisible({ timeout: 5000 });
      });

      await test.step("Switch to backup code, enter it, and verify successful login", async () => {
        // Click the "Use a backup code instead" toggle
        // From the signin page: renders as a <button> with text "Use a backup code instead"
        const backupToggle = twoFADialog!
          .locator("button")
          .filter({ hasText: /backup/i })
          .first();
        await expect(backupToggle).toBeVisible({ timeout: 5000 });
        await backupToggle.click();

        // Enter backup code in the input field (now shows a text input with placeholder "XXXXXXXX")
        const backupInput = twoFADialog!
          .locator('input[placeholder="XXXXXXXX"]')
          .first();
        await expect(backupInput).toBeVisible({ timeout: 5000 });
        await backupInput.fill(firstBackupCode!);

        // Click verify button
        await twoFADialog!.getByRole("button", { name: /^verify$/i }).click();

        // Assert successful login
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });
        expect(page.url()).toContain("/en-US");
      });
    } finally {
      await api.deleteUser(userId);
    }
  });

  test("2FA with invalid code shows error", async ({ page, api, baseURL }) => {
    const timestamp = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const testEmail = `2fa-invalid-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const testPassword = "Password123!";

    const userResult = await api.createUser({
      name: `2FA Invalid User ${timestamp}`,
      email: testEmail,
      password: testPassword,
    });
    const userId = userResult.data.id;

    try {
      const signinPage = new SigninPage(page);
      let twoFADialog: ReturnType<typeof page.locator> | undefined;

      await test.step("Sign in to establish session", async () => {
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();
        await page.waitForURL((url) => !url.pathname.includes("/signin"), {
          timeout: 30000,
        });
      });

      await test.step("Set up 2FA", async () => {
        await setup2FA(page, baseURL!);
      });

      await test.step("Sign out and sign in again to trigger the 2FA dialog", async () => {
        // Sign out by clearing cookies
        await page.context().clearCookies();

        // Sign in again to trigger 2FA
        await signinPage.goto();
        await signinPage.fillCredentials(testEmail, testPassword);
        await signinPage.submit();

        // Wait for 2FA dialog
        twoFADialog = page.locator('[role="dialog"]').first();
        await expect(twoFADialog).toBeVisible({ timeout: 15000 });
        await expect(
          twoFADialog
            .getByText(/two.factor|two factor|verification code|authenticator/i)
            .first()
        ).toBeVisible({ timeout: 5000 });
      });

      await test.step("Enter an invalid code and confirm the error keeps the user on signin", async () => {
        // Enter an invalid 6-digit code using the hidden OTP input
        const otpInput = twoFADialog!
          .locator(
            'input[inputmode="numeric"], input[autocomplete="one-time-code"]'
          )
          .first();
        await otpInput.click();
        await otpInput.fill("000000");

        // The onComplete handler fires automatically — wait for error message to appear
        await expect(
          twoFADialog!.getByText(/invalid|incorrect|wrong/i).first()
        ).toBeVisible({ timeout: 10000 });

        // Assert still on signin page (not redirected)
        expect(page.url()).toContain("/signin");
      });
    } finally {
      await api.deleteUser(userId);
    }
  });
});
