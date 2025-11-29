import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test.describe.serial("SSO Sign-In Flow @sso", () => {
  // Clean up SSO providers before each test to ensure isolation
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Disable all SSO providers to start with a clean state
    // Use more flexible selectors that match the actual text on the page
    const providers = [
      { name: "Google", selector: "text=/Google/i" },
      { name: "Apple", selector: "text=/Apple/i" },
      { name: "SAML", selector: "text=/SAML/i" },
    ];

    for (const provider of providers) {
      // Find the switch that's in the same section as the provider text
      const section = page.locator(provider.selector).first().locator("../..");
      const switchElement = section.locator('[role="switch"]').first();
      const state = await switchElement.getAttribute("data-state");

      if (state === "checked") {
        await switchElement.click();
        await expect(switchElement).toHaveAttribute("data-state", "unchecked");
      }
    }
  });

  test("should display Google SSO button on sign-in page when provider is enabled", async ({
    page,
  }) => {
    // First login as admin and enable Google SSO
    await loginAsAdmin(page);
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Find and configure Google OAuth - use flexible selector
    const googleSection = page
      .locator("text=/Google/i")
      .first()
      .locator("../..");

    // Check if it needs setup or is already configured
    const setupButton = googleSection.getByRole("button", { name: "Setup" });
    const configureButton = googleSection.getByRole("button", {
      name: "Configure",
    });

    if (await setupButton.isVisible()) {
      await setupButton.click();
      // Fill in dummy config
      await page
        .getByLabel("Client ID")
        .fill("test-client-id.apps.googleusercontent.com");
      await page.getByLabel("Client Secret").fill("test-client-secret");
      await page.getByRole("button", { name: "Save Configuration" }).click();
      // Wait for dialog to close
      await expect(page.locator('[role="dialog"]')).not.toBeVisible({
        timeout: 5000,
      });
    } else if (await configureButton.isVisible()) {
      // Already configured, skip configuration
    }

    // Enable Google OAuth
    const googleSwitch = googleSection.locator('[role="switch"]');
    await googleSwitch.click();
    await expect(googleSwitch).toHaveAttribute("data-state", "checked");

    // Clear auth state and go to sign-in page
    await page.context().clearCookies();
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    // Verify Google SSO button is visible on sign-in page
    await expect(
      page.getByRole("button", { name: /Continue with Google/i })
    ).toBeVisible();
  });

  test("should not display SSO buttons when providers are disabled", async ({
    page,
  }) => {
    // Providers are already disabled by beforeEach
    // Go directly to sign-in page
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    // When providers are disabled, SSO buttons should not be visible
    await expect(
      page.getByRole("button", { name: /Continue with Google/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continue with Apple/i })
    ).not.toBeVisible();

    // Only the regular sign-in form should be visible
    await expect(page.getByTestId("email-input")).toBeVisible();
    await expect(page.getByTestId("password-input")).toBeVisible();
  });

  test("should enforce Force SSO when enabled", async ({ page }) => {
    // First login as admin and enable Force SSO
    await loginAsAdmin(page);
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Configure and enable Google OAuth first
    const googleSection = page
      .locator("text=/Google/i")
      .first()
      .locator("../..");

    // Check if it's already configured or needs setup
    const configureButton = googleSection.getByRole("button", {
      name: "Configure",
    });
    const setupButton = googleSection.getByRole("button", { name: "Setup" });

    if (await setupButton.isVisible()) {
      await setupButton.click();
      // Fill in configuration
      await page
        .getByLabel("Client ID")
        .fill("test-client-id.apps.googleusercontent.com");
      await page.getByLabel("Client Secret").fill("test-client-secret");
      await page.getByRole("button", { name: "Save Configuration" }).click();
      await expect(page.locator('[role="dialog"]')).not.toBeVisible({
        timeout: 5000,
      });
    } else if (await configureButton.isVisible()) {
      // Already configured, just need to enable it
    }

    // Enable Google OAuth if not already enabled
    const googleSwitch = googleSection.locator('[role="switch"]');
    const switchState = await googleSwitch.getAttribute("data-state");
    if (switchState !== "checked") {
      await googleSwitch.click();
      await expect(googleSwitch).toHaveAttribute("data-state", "checked");
    }

    // Find and enable Force SSO - it's in the global settings section
    const forceSsoSwitch = page
      .locator('div:has-text("Force SSO Login")')
      .locator('[role="switch"]')
      .first();
    await forceSsoSwitch.click();
    await expect(forceSsoSwitch).toHaveAttribute("data-state", "checked");

    // Clear auth and go to sign-in page
    await page.context().clearCookies();
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    // When Force SSO is enabled, the regular sign-in form should be hidden
    await expect(page.getByTestId("email-input")).not.toBeVisible();
    await expect(page.getByTestId("password-input")).not.toBeVisible();

    // Only SSO buttons should be visible
    await expect(
      page.getByRole("button", { name: /Continue with Google/i })
    ).toBeVisible();
  });

  test("should display Apple Sign In when enabled", async ({ page }) => {
    // First login as admin and enable Apple Sign In
    await loginAsAdmin(page);
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Find and configure Apple Sign In - use flexible selector
    const appleSection = page.locator("text=/Apple/i").first().locator("../..");

    // Check if it needs setup or is already configured
    const setupButton = appleSection.getByRole("button", { name: "Setup" });
    const configureButton = appleSection.getByRole("button", {
      name: "Configure",
    });

    if (await setupButton.isVisible()) {
      await setupButton.click();
      // Fill in dummy config
      await page.getByLabel("Service ID").fill("com.example.testplanit");
      await page.getByLabel("Team ID").fill("TEAMID123");
      await page.getByLabel("Key ID").fill("KEYID456");
      await page
        .getByLabel("Private Key")
        .fill(
          "-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----"
        );
      await page.getByRole("button", { name: "Save Configuration" }).click();
      // Wait for dialog to close
      await expect(page.locator('[role="dialog"]')).not.toBeVisible({
        timeout: 5000,
      });
    } else if (await configureButton.isVisible()) {
      // Already configured, skip configuration
    }

    // Enable Apple Sign In
    const appleSwitch = appleSection.locator('[role="switch"]');
    await appleSwitch.click();
    await expect(appleSwitch).toHaveAttribute("data-state", "checked");

    // Clear auth state and go to sign-in page
    await page.context().clearCookies();
    await page.goto("/en-US/signin");
    await page.waitForLoadState("networkidle");

    // Verify Apple Sign In button is visible
    await expect(
      page.getByRole("button", { name: /Continue with Apple/i })
    ).toBeVisible();
  });
});
