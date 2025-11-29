import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe.serial("SSO Admin Interface @sso", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("should display SSO menu item in admin navigation", async ({ page }) => {
    await page.goto("/en-US/admin");

    // Wait for admin page to load
    await page.waitForLoadState("networkidle");

    // Check if Authentication menu item is visible (was previously "SSO")
    const ssoMenuItem = page.getByRole("link", { name: "Authentication" });
    await expect(ssoMenuItem).toBeVisible();

    // Click on Authentication menu item and wait for navigation
    await ssoMenuItem.click();

    // Wait for the URL to change to the SSO page
    await page.waitForURL("**/admin/sso", { timeout: 20000 });
    await page.waitForLoadState("networkidle");

    // Now verify we're on the SSO page - don't rely on test-id that may not exist
    // Check for Authentication text in the page content
    await expect(page.locator("text=Authentication").first()).toBeVisible();

    // Also verify the description text to confirm we're on the right page
    await expect(
      page.locator("text=Manage Single Sign-On providers")
    ).toBeVisible();
  });

  test("should configure Google OAuth provider", async ({ page }) => {
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Find the Google OAuth section - it's the one with the Google OAuth title
    // The title comes from translation, so we look for the switch next to Google text
    const googleSection = page
      .locator("text=/Google/i")
      .first()
      .locator("../..");

    // Click Setup button for Google OAuth (when not configured, it shows "Setup")
    await googleSection.getByRole("button", { name: "Setup" }).click();

    // Wait for dialog to be visible
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Fill in Google OAuth configuration in the dialog
    // Use getByLabel for better reliability
    await page
      .getByLabel("Client ID")
      .fill("test-client-id.apps.googleusercontent.com");
    await page.getByLabel("Client Secret").fill("test-client-secret-xyz123");

    // Save configuration - the button text is "Save Configuration"
    await page.getByRole("button", { name: "Save Configuration" }).click();

    // Verify configuration was saved (dialog closes)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({
      timeout: 10000,
    });

    // The switch should already be enabled after saving configuration
    // Verify the switch is now checked
    const googleSectionAfterSave = page
      .locator("text=/Google/i")
      .first()
      .locator("../..");
    const googleSwitch = googleSectionAfterSave
      .locator('[role="switch"]')
      .first();

    // The provider is automatically enabled when configured
    await expect(googleSwitch).toHaveAttribute("data-state", "checked", {
      timeout: 10000,
    });
  });

  test("should configure Apple Sign In", async ({ page }) => {
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Find the Apple Sign In section - look for Apple text
    const appleSection = page.locator("text=/Apple/i").first().locator("../..");

    // Click Configure button for Apple Sign In (it shows "Configure" when already configured)
    // First check if it's already configured, otherwise click Setup
    const configureButton = appleSection.getByRole("button", {
      name: "Configure",
    });
    const setupButton = appleSection.getByRole("button", { name: "Setup" });

    if (await setupButton.isVisible()) {
      await setupButton.click();
    } else if (await configureButton.isVisible()) {
      await configureButton.click();
    }

    // Wait for dialog to be visible
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // Fill in Apple Sign In configuration in the dialog using proper selectors
    await page.getByLabel("Service ID").fill("com.example.testplanit");
    await page.getByLabel("Team ID").fill("TEAMID123");
    await page.getByLabel("Key ID").fill("KEYID456");
    await page
      .getByLabel("Private Key")
      .fill("-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----");

    // Save configuration - the button text is "Save Configuration"
    await page.getByRole("button", { name: "Save Configuration" }).click();

    // Verify configuration was saved (dialog closes)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({
      timeout: 10000,
    });

    // The switch should already be enabled after saving configuration
    // Verify the switch is now checked
    const appleSectionAfterSave = page
      .locator("text=/Apple/i")
      .first()
      .locator("../..");
    const appleSwitch = appleSectionAfterSave
      .locator('[role="switch"]')
      .first();

    // The provider is automatically enabled when configured
    await expect(appleSwitch).toHaveAttribute("data-state", "checked", {
      timeout: 10000,
    });
  });

  test("should configure domain restrictions", async ({ page }) => {
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Find the switch that's in the same row as "Restrict Email Domains" text
    // The switch appears right after the text in the page structure
    const domainRestrictionSwitch = page
      .locator('div:has-text("Restrict Email Domains")')
      .locator('[role="switch"]')
      .first();

    // Check current state - if already checked, uncheck it first
    const currentState =
      await domainRestrictionSwitch.getAttribute("data-state");
    if (currentState === "checked") {
      await domainRestrictionSwitch.click();
      await expect(domainRestrictionSwitch).toHaveAttribute(
        "data-state",
        "unchecked"
      );
    }

    // Now enable it
    await domainRestrictionSwitch.click();
    await expect(domainRestrictionSwitch).toHaveAttribute(
      "data-state",
      "checked"
    );

    // Add a new allowed domain (testplanit.com is already in the list)
    await page.fill('input[placeholder*="example.com"]', "newdomain.com");
    await page.getByRole("button", { name: "Add Domain" }).click();

    // Verify domain was added
    await expect(page.locator("text=newdomain.com")).toBeVisible();

    // Try to add an invalid domain
    await page.fill('input[placeholder*="example.com"]', "invalid domain");
    await page.getByRole("button", { name: "Add Domain" }).click();

    // Verify the invalid domain was NOT added to the list
    // The input should still contain the invalid text but it shouldn't be in the domain list
    await page.waitForTimeout(1000); // Wait a bit for any potential addition
    // Check that "invalid domain" doesn't appear as a domain entry with a switch
    const invalidDomainEntry = page
      .locator('text="invalid domain"')
      .locator("..")
      .locator('[role="switch"]');
    await expect(invalidDomainEntry).not.toBeVisible();
  });

  test("should toggle Force SSO setting", async ({ page }) => {
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Find the switch that's in the same row as "Force SSO Login" text
    // The switch appears right after the text in the page structure
    const forceSsoSwitch = page
      .locator('div:has-text("Force SSO Login")')
      .locator('[role="switch"]')
      .first();

    // Toggle Force SSO on
    await forceSsoSwitch.click();

    // Verify it's enabled
    await expect(forceSsoSwitch).toHaveAttribute("data-state", "checked");

    // Toggle it back off
    await forceSsoSwitch.click();

    // Verify it's disabled
    await expect(forceSsoSwitch).toHaveAttribute("data-state", "unchecked");
  });
});
