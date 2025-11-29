import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe.serial("Magic Link Authentication @magic-link", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("should display Magic Link option on sign-in page when configured", async ({
    page,
  }) => {
    // Navigate to SSO admin page to check Magic Link configuration
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Check if Magic Link is configured by looking for the status
    const magicLinkSection = page
      .locator("text=/Magic Link/i")
      .first()
      .locator("../..");

    // Verify Magic Link section is visible
    await expect(magicLinkSection).toBeVisible();

    // Clear auth and go to sign-in page
    await page.context().clearCookies();
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    // If Magic Link is configured, the button should be visible
    // Note: This test assumes Magic Link is configured via environment variables
    // The actual visibility depends on EMAIL_SERVER_HOST, EMAIL_SERVER_PORT, etc.
    const magicLinkButton = page.getByRole("button", {
      name: /Sign in with Magic Link/i,
    });

    // Check if button exists (may not be visible if email is not configured)
    const buttonCount = await magicLinkButton.count();
    if (buttonCount > 0) {
      await expect(magicLinkButton).toBeVisible();
    }
  });

  test("should show success message for non-existent user (email enumeration protection)", async ({
    page,
  }) => {
    // Clear auth and go to sign-in page
    await page.context().clearCookies();
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    // Check if Magic Link button is available
    const magicLinkButton = page.getByRole("button", {
      name: /Sign in with Magic Link/i,
    });

    const buttonCount = await magicLinkButton.count();
    if (buttonCount === 0) {
      test.skip(true, "Magic Link not configured");
    }

    // Click Magic Link button to open dialog
    await magicLinkButton.click();

    // Wait for dialog to open
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Enter a non-existent email address
    const nonExistentEmail = `nonexistent-${Date.now()}@example.com`;
    await page.getByLabel(/email/i).fill(nonExistentEmail);

    // Record start time to verify timing attack protection
    const startTime = Date.now();

    // Click send button
    await page.getByRole("button", { name: /Send Magic Link/i }).click();

    // Wait for success message (email enumeration protection - always shows success)
    await expect(page.getByText(/Check your email/i)).toBeVisible({
      timeout: 10000, // Allow time for the 5-second delay
    });

    // Verify the delay was approximately 5 seconds (timing attack protection)
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(4500); // Allow some variance
    expect(elapsed).toBeLessThan(7000); // Should not be much longer than 5 seconds

    // Verify success message shows the email address
    await expect(
      page.getByText(new RegExp(nonExistentEmail, "i"))
    ).toBeVisible();
  });

  test("should prevent rapid enumeration attempts", async ({ page }) => {
    // Clear auth and go to sign-in page
    await page.context().clearCookies();
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    // Check if Magic Link button is available
    const magicLinkButton = page.getByRole("button", {
      name: /Sign in with Magic Link/i,
    });

    const buttonCount = await magicLinkButton.count();
    if (buttonCount === 0) {
      test.skip(true, "Magic Link not configured");
    }

    // Click Magic Link button to open dialog
    await magicLinkButton.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Test with first non-existent email
    const email1 = `test1-${Date.now()}@example.com`;
    await page.getByLabel(/email/i).fill(email1);

    const start1 = Date.now();
    await page.getByRole("button", { name: /Send Magic Link/i }).click();
    await expect(page.getByText(/Check your email/i)).toBeVisible({
      timeout: 10000,
    });
    const elapsed1 = Date.now() - start1;

    // Close the dialog and reopen
    await page.getByRole("button", { name: /close/i }).click();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    await magicLinkButton.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Test with second non-existent email
    const email2 = `test2-${Date.now()}@example.com`;
    await page.getByLabel(/email/i).fill(email2);

    const start2 = Date.now();
    await page.getByRole("button", { name: /Send Magic Link/i }).click();
    await expect(page.getByText(/Check your email/i)).toBeVisible({
      timeout: 10000,
    });
    const elapsed2 = Date.now() - start2;

    // Both attempts should take approximately the same time (timing attack protection)
    expect(Math.abs(elapsed1 - elapsed2)).toBeLessThan(1000); // Within 1 second of each other
  });

  test("should show loading state during Magic Link request", async ({
    page,
  }) => {
    // Clear auth and go to sign-in page
    await page.context().clearCookies();
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    // Check if Magic Link button is available
    const magicLinkButton = page.getByRole("button", {
      name: /Sign in with Magic Link/i,
    });

    const buttonCount = await magicLinkButton.count();
    if (buttonCount === 0) {
      test.skip(true, "Magic Link not configured");
    }

    // Click Magic Link button to open dialog
    await magicLinkButton.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Enter email
    await page.getByLabel(/email/i).fill(`test-${Date.now()}@example.com`);

    // Click send button
    await page.getByRole("button", { name: /Send Magic Link/i }).click();

    // Verify loading state appears (spinner should be visible)
    await expect(page.locator(".animate-spin")).toBeVisible();

    // Verify button is disabled during loading
    const sendButton = page.getByRole("button", { name: /sending/i });
    await expect(sendButton).toBeDisabled();

    // Wait for completion
    await expect(page.getByText(/Check your email/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("should validate email format", async ({ page }) => {
    // Clear auth and go to sign-in page
    await page.context().clearCookies();
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    // Check if Magic Link button is available
    const magicLinkButton = page.getByRole("button", {
      name: /Sign in with Magic Link/i,
    });

    const buttonCount = await magicLinkButton.count();
    if (buttonCount === 0) {
      test.skip(true, "Magic Link not configured");
    }

    // Click Magic Link button to open dialog
    await magicLinkButton.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Try invalid email formats
    const invalidEmails = [
      "notanemail",
      "missing@domain",
      "@nodomain.com",
      "spaces in email@test.com",
    ];

    for (const invalidEmail of invalidEmails) {
      await page.getByLabel(/email/i).fill(invalidEmail);
      await page.getByRole("button", { name: /Send Magic Link/i }).click();

      // Should show validation error
      await expect(
        page.getByText(/invalid email|email.*invalid/i)
      ).toBeVisible();

      // Clear the input for next iteration
      await page.getByLabel(/email/i).clear();
    }
  });

  test("should allow closing Magic Link dialog", async ({ page }) => {
    // Clear auth and go to sign-in page
    await page.context().clearCookies();
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    // Check if Magic Link button is available
    const magicLinkButton = page.getByRole("button", {
      name: /Sign in with Magic Link/i,
    });

    const buttonCount = await magicLinkButton.count();
    if (buttonCount === 0) {
      test.skip(true, "Magic Link not configured");
    }

    // Click Magic Link button to open dialog
    await magicLinkButton.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Click "Back to Sign In" button
    await page
      .getByRole("button", { name: /back to sign in/i })
      .first()
      .click();

    // Dialog should close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    // Regular sign-in form should still be visible
    await expect(page.getByTestId("email-input")).toBeVisible();
  });

  test("should display Magic Link status in admin SSO page", async ({
    page,
  }) => {
    // Navigate to SSO admin page
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Find Magic Link section
    const magicLinkSection = page
      .locator("text=/Magic Link/i")
      .first()
      .locator("../..");

    // Verify section is visible
    await expect(magicLinkSection).toBeVisible();

    // Check for configuration status badge
    const statusBadge = magicLinkSection.locator('[class*="badge"]');
    await expect(statusBadge).toBeVisible();

    // Status should be either "Configured" or "Not Configured"
    const badgeText = await statusBadge.textContent();
    expect(badgeText).toMatch(/configured|not configured/i);
  });
});
