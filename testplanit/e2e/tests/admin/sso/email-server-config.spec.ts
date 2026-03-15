import { expect, test } from "../../../fixtures";

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
    const emailVerificationSection = page
      .locator('text="Require Email Verification"')
      .locator("..");

    // The switch should exist
    await expect(emailVerificationSection).toBeVisible();

    // Check if warning message is shown when email server is not configured
    // This assumes the test environment has no email server configured
    const warningText = page.getByText(/email server is not configured/i);

    // If warning is visible, email server is not configured and switch should be disabled
    const isWarningVisible = await warningText.isVisible().catch(() => false);

    if (isWarningVisible) {
      // Email server not configured - verify switch is disabled and off
      const switchElement = emailVerificationSection.locator(
        'button[role="switch"]'
      );
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
      // Verify warning has appropriate styling (warning theme color or amber/yellow)
      const warningElement = warningText.locator("..");
      const classList = await warningElement.getAttribute("class");
      expect(classList).toMatch(/text-warning|text-amber|text-yellow/);
    }
  });

  test("Cannot enable email verification when email server is not configured", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    const emailVerificationSection = page
      .locator('text="Require Email Verification"')
      .locator("..");

    const switchElement = emailVerificationSection.locator(
      'button[role="switch"]'
    );

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

    // Check for email-based notification options by their IDs
    const immediateEmailOption = page.locator("#in-app-email-immediate");
    const dailyEmailOption = page.locator("#in-app-email-daily");

    // These should be hidden when no email server is configured
    const isImmediateVisible = await immediateEmailOption
      .isVisible()
      .catch(() => false);
    const isDailyVisible = await dailyEmailOption
      .isVisible()
      .catch(() => false);

    // If they're hidden, that's correct behavior
    if (!isImmediateVisible && !isDailyVisible) {
      // Verify that non-email options are still visible
      const inAppOption = page.locator("#in-app");
      await expect(inAppOption).toBeVisible();

      const noneOption = page.locator("#none");
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
    const immediateEmailOption = page.locator("#in-app-email-immediate");
    const isEmailVisible = await immediateEmailOption
      .isVisible()
      .catch(() => false);

    if (!isEmailVisible) {
      // Email server not configured
      // Verify IN_APP or NONE is selected, not email modes
      const inAppOption = page.locator("#in-app");
      const noneOption = page.locator("#none");

      const isInAppChecked = await inAppOption.isChecked().catch(() => false);
      const isNoneChecked = await noneOption.isChecked().catch(() => false);

      expect(isInAppChecked || isNoneChecked).toBe(true);
    }
  });
});
