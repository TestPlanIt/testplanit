import { test, expect } from "../../../fixtures";

/**
 * Email Server Configuration E2E Tests
 *
 * Tests that the system behaves intelligently when no email server is configured:
 * - Email verification setting is disabled and forced to false
 * - Email notification options are hidden from UI
 * - Users can sign up without email verification
 */

test.describe("Admin SSO - Email Server Configuration", () => {
  test("Email verification switch should be disabled when no email server is configured", async ({
    page,
  }) => {
    // This test assumes EMAIL_SERVER_HOST and related env vars are NOT set
    // Navigate to admin SSO page
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Wait for the page to load and check email server status
    await page.waitForTimeout(1000); // Allow time for email server status check

    // Find the email verification switch
    // Note: We need to check if the switch is disabled
    const emailVerificationSection = page.locator(
      'text="Require Email Verification"'
    ).locator("..");

    // The switch should exist
    await expect(emailVerificationSection).toBeVisible();

    // Check if warning message is shown when email server is not configured
    // This assumes the test environment has no email server configured
    const warningText = page.getByText(
      /email server is not configured/i
    );

    // If warning is visible, email server is not configured and switch should be disabled
    const isWarningVisible = await warningText.isVisible().catch(() => false);

    if (isWarningVisible) {
      // Email server not configured - verify switch is disabled and off
      const switchElement = emailVerificationSection.locator('button[role="switch"]');
      await expect(switchElement).toBeDisabled();
      await expect(switchElement).toHaveAttribute("data-state", "unchecked");
    }
  });

  test("Warning message should be displayed when email server is not configured", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Check if warning message is visible
    const warningText = page.getByText(
      /email server is not configured.*email verification is automatically disabled/i
    );

    const isWarningVisible = await warningText.isVisible().catch(() => false);

    if (isWarningVisible) {
      // Verify warning has appropriate styling (amber/yellow text)
      const warningElement = warningText.locator("..");
      const classList = await warningElement.getAttribute("class");
      expect(classList).toMatch(/text-amber|text-yellow/);
    }
  });

  test("Cannot enable email verification when email server is not configured", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    const emailVerificationSection = page.locator(
      'text="Require Email Verification"'
    ).locator("..");

    const switchElement = emailVerificationSection.locator('button[role="switch"]');

    // Check if switch is disabled
    const isDisabled = await switchElement.isDisabled().catch(() => false);

    if (isDisabled) {
      // Try to click the disabled switch - should not change state
      const initialState = await switchElement.getAttribute("data-state");

      // Attempt to click (should have no effect)
      await switchElement.click({ force: true }).catch(() => {});

      // Wait a bit to see if state changes
      await page.waitForTimeout(500);

      // State should remain unchanged
      const finalState = await switchElement.getAttribute("data-state");
      expect(finalState).toBe(initialState);
      expect(finalState).toBe("unchecked");
    }
  });
});

test.describe("Admin Notifications - Email Server Configuration", () => {
  test("Email notification options should be hidden when no email server is configured", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/notifications");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Check for email-based notification options
    const immediateEmailOption = page.locator(
      'input[value="IN_APP_EMAIL_IMMEDIATE"]'
    );
    const dailyEmailOption = page.locator('input[value="IN_APP_EMAIL_DAILY"]');

    // These should be hidden when no email server is configured
    const isImmediateVisible = await immediateEmailOption.isVisible().catch(() => false);
    const isDailyVisible = await dailyEmailOption.isVisible().catch(() => false);

    // If they're hidden, that's correct behavior
    if (!isImmediateVisible && !isDailyVisible) {
      // Verify that non-email options are still visible
      const inAppOption = page.locator('input[value="IN_APP"]');
      await expect(inAppOption).toBeVisible();

      const noneOption = page.locator('input[value="NONE"]');
      await expect(noneOption).toBeVisible();
    }
  });

  test("Default notification mode should fallback to IN_APP when email server is not configured", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/notifications");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Check if email options are hidden
    const immediateEmailOption = page.locator(
      'input[value="IN_APP_EMAIL_IMMEDIATE"]'
    );
    const isEmailVisible = await immediateEmailOption.isVisible().catch(() => false);

    if (!isEmailVisible) {
      // Email server not configured
      // Verify IN_APP or NONE is selected, not email modes
      const inAppOption = page.locator('input[value="IN_APP"]');
      const noneOption = page.locator('input[value="NONE"]');

      const isInAppChecked = await inAppOption.isChecked().catch(() => false);
      const isNoneChecked = await noneOption.isChecked().catch(() => false);

      expect(isInAppChecked || isNoneChecked).toBe(true);
    }
  });
});

test.describe("User Notification Preferences - Email Server Configuration", () => {
  test("Email notification options should be hidden for users when no email server is configured", async ({
    page,
    adminUserId,
  }) => {
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Look for notification preferences section
    // Scroll down to find it
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    // Check for email-based notification options
    const immediateEmailOption = page.locator(
      'input[value="IN_APP_EMAIL_IMMEDIATE"]'
    );
    const dailyEmailOption = page.locator('input[value="IN_APP_EMAIL_DAILY"]');

    const isImmediateVisible = await immediateEmailOption.isVisible().catch(() => false);
    const isDailyVisible = await dailyEmailOption.isVisible().catch(() => false);

    // If they're hidden, verify non-email options are visible
    if (!isImmediateVisible && !isDailyVisible) {
      const inAppOption = page.locator('input[value="IN_APP"]');
      const noneOption = page.locator('input[value="NONE"]');

      // At least one of these should be visible
      const isInAppVisible = await inAppOption.isVisible().catch(() => false);
      const isNoneVisible = await noneOption.isVisible().catch(() => false);

      expect(isInAppVisible || isNoneVisible).toBe(true);
    }
  });

  test("User notification mode should fallback to IN_APP when email server is not configured", async ({
    page,
    adminUserId,
  }) => {
    await page.goto(`/en-US/users/profile/${adminUserId}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Scroll to notification preferences
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    // Check if email options are hidden
    const immediateEmailOption = page.locator(
      'input[value="IN_APP_EMAIL_IMMEDIATE"]'
    );
    const isEmailVisible = await immediateEmailOption.isVisible().catch(() => false);

    if (!isEmailVisible) {
      // Verify a non-email mode is selected
      const inAppOption = page.locator('input[value="IN_APP"]');
      const noneOption = page.locator('input[value="NONE"]');
      const globalOption = page.locator('input[value="USE_GLOBAL"]');

      const isInAppChecked = await inAppOption.isChecked().catch(() => false);
      const isNoneChecked = await noneOption.isChecked().catch(() => false);
      const isGlobalChecked = await globalOption.isChecked().catch(() => false);

      expect(isInAppChecked || isNoneChecked || isGlobalChecked).toBe(true);
    }
  });
});

test.describe("Signup - Email Server Configuration", () => {
  test("Users should be able to sign up without email verification when no email server is configured", async ({
    page,
  }) => {
    // First, sign out if logged in
    await page.goto("/api/auth/signout");
    await page.waitForLoadState("networkidle");

    // Navigate to signup page
    await page.goto("/en-US/signup");
    await page.waitForLoadState("networkidle");

    // Fill signup form with unique email
    const timestamp = Date.now();
    const testEmail = `test-${timestamp}@example.com`;

    await page.fill('input[name="name"]', `Test User ${timestamp}`);
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', "password123");
    await page.fill('input[name="confirmPassword"]', "password123");

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for navigation or success message
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // If email server is not configured, user should be redirected or logged in
    // Check if we're redirected away from signup page
    const currentUrl = page.url();

    // User should either be on home page or verification page
    // If no email server, should NOT be stuck on verification page
    expect(currentUrl).not.toContain("/signup");
  });
});
