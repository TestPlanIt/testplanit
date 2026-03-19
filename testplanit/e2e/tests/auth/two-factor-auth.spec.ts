import { createHmac } from "crypto";
import { expect, test } from "../../fixtures";
import { SigninPage } from "../../page-objects/signin.page";

const TEST_EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN || "example.com";

/**
 * Generate a TOTP code from a Base32-encoded secret.
 * Uses SHA-1 HMAC per RFC 6238.
 */
function generateTOTP(secret: string): string {
  const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replace(/=+$/, "")) {
    const val = base32chars.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4);
  const hmac = createHmac("sha1", Buffer.from(bytes));
  hmac.update(counterBuf);
  const hmacResult = hmac.digest();
  const offset = hmacResult[hmacResult.length - 1] & 0x0f;
  const code =
    (((hmacResult[offset] & 0x7f) << 24) |
      ((hmacResult[offset + 1] & 0xff) << 16) |
      ((hmacResult[offset + 2] & 0xff) << 8) |
      (hmacResult[offset + 3] & 0xff)) %
    1000000;
  return code.toString().padStart(6, "0");
}

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
    const timestamp = Date.now();
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

      // Sign in to establish a session
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, testPassword);
      await signinPage.submit();
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });

      // Set up 2FA via the voluntary setup path
      const { secret, backupCodes } = await setup2FA(page, baseURL!);
      expect(backupCodes.length).toBeGreaterThan(0);

      // Sign out by clearing cookies (most reliable approach)
      await page.context().clearCookies();

      // Sign in again — should trigger 2FA dialog
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, testPassword);
      await signinPage.submit();

      // Wait for the 2FA dialog to appear
      const twoFADialog = page.locator('[role="dialog"]').first();
      await expect(twoFADialog).toBeVisible({ timeout: 15000 });
      await expect(
        twoFADialog.getByText(/two.factor|two factor|verification code|authenticator/i).first()
      ).toBeVisible({ timeout: 5000 });

      // Generate a fresh TOTP code (must be current time-step)
      const freshTotpCode = generateTOTP(secret);

      // The input-otp library renders a hidden <input> behind visual slots.
      // Click the OTP input and fill with the 6-digit code.
      const otpInput = twoFADialog
        .locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]')
        .first();
      await otpInput.click();
      await otpInput.fill(freshTotpCode);

      // The InputOTP triggers onComplete automatically when all 6 digits are entered
      // Wait for redirect to home page
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });
      expect(page.url()).toContain("/en-US");
    } finally {
      await api.deleteUser(userId);
    }
  });

  test("2FA verification with backup code", async ({
    page,
    api,
    baseURL,
  }) => {
    const timestamp = Date.now();
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

      // Sign in to establish session
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, testPassword);
      await signinPage.submit();
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });

      // Set up 2FA and save backup codes
      const { backupCodes } = await setup2FA(page, baseURL!);
      expect(backupCodes.length).toBeGreaterThan(0);
      const firstBackupCode = backupCodes[0];

      // Sign out by clearing cookies
      await page.context().clearCookies();

      // Sign in again to trigger 2FA
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, testPassword);
      await signinPage.submit();

      // Wait for 2FA dialog
      const twoFADialog = page.locator('[role="dialog"]').first();
      await expect(twoFADialog).toBeVisible({ timeout: 15000 });
      await expect(
        twoFADialog.getByText(/two.factor|two factor|verification code|authenticator/i).first()
      ).toBeVisible({ timeout: 5000 });

      // Click the "Use a backup code instead" toggle
      // From the signin page: renders as a <button> with text "Use a backup code instead"
      const backupToggle = twoFADialog
        .locator("button")
        .filter({ hasText: /backup/i })
        .first();
      await expect(backupToggle).toBeVisible({ timeout: 5000 });
      await backupToggle.click();

      // Enter backup code in the input field (now shows a text input with placeholder "XXXXXXXX")
      const backupInput = twoFADialog
        .locator('input[placeholder="XXXXXXXX"]')
        .first();
      await expect(backupInput).toBeVisible({ timeout: 5000 });
      await backupInput.fill(firstBackupCode);

      // Click verify button
      await twoFADialog.getByRole("button", { name: /^verify$/i }).click();

      // Assert successful login
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });
      expect(page.url()).toContain("/en-US");
    } finally {
      await api.deleteUser(userId);
    }
  });

  test("2FA with invalid code shows error", async ({
    page,
    api,
    baseURL,
  }) => {
    const timestamp = Date.now();
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

      // Sign in to establish session
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, testPassword);
      await signinPage.submit();
      await page.waitForURL((url) => !url.pathname.includes("/signin"), {
        timeout: 30000,
      });

      // Set up 2FA
      await setup2FA(page, baseURL!);

      // Sign out by clearing cookies
      await page.context().clearCookies();

      // Sign in again to trigger 2FA
      await signinPage.goto();
      await signinPage.fillCredentials(testEmail, testPassword);
      await signinPage.submit();

      // Wait for 2FA dialog
      const twoFADialog = page.locator('[role="dialog"]').first();
      await expect(twoFADialog).toBeVisible({ timeout: 15000 });
      await expect(
        twoFADialog.getByText(/two.factor|two factor|verification code|authenticator/i).first()
      ).toBeVisible({ timeout: 5000 });

      // Enter an invalid 6-digit code using the hidden OTP input
      const otpInput = twoFADialog
        .locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]')
        .first();
      await otpInput.click();
      await otpInput.fill("000000");

      // The onComplete handler fires automatically — wait for error message to appear
      await expect(
        twoFADialog.getByText(/invalid|incorrect|wrong/i).first()
      ).toBeVisible({ timeout: 10000 });

      // Assert still on signin page (not redirected)
      expect(page.url()).toContain("/signin");
    } finally {
      await api.deleteUser(userId);
    }
  });
});
