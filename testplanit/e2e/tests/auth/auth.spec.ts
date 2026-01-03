import { test, expect } from "../../fixtures";

/**
 * Authentication Tests
 *
 * Test cases for verifying authentication and user session functionality.
 */
test.describe("Authentication", () => {
  test("Authenticated User Can Access Protected Pages @smoke", async ({ page }) => {
    await page.goto("/en-US/projects");

    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/signin");
    expect(page.url()).toContain("/projects");
  });

  test("Display User Information in Header @smoke", async ({ page }) => {
    await page.goto("/en-US/projects");
    await page.waitForLoadState("networkidle");

    // Verify we're authenticated (not redirected to signin)
    expect(page.url()).not.toContain("/signin");

    // Find the user menu button in the header - it's labeled "User menu" in aria
    const userMenu = page.locator(
      'button[aria-label*="User menu" i], button:has-text("User menu"), [data-testid="user-menu"], [data-testid="user-avatar"], button:has([data-testid="avatar"])'
    ).first();
    await expect(userMenu).toBeVisible({ timeout: 10000 });

    // Click to open the user menu
    await userMenu.click();

    // Verify user information is displayed in the dropdown
    const userDropdown = page.locator('[role="menu"], [data-testid="user-dropdown"]').first();
    await expect(userDropdown).toBeVisible({ timeout: 5000 });

    // Look for user email or name in the dropdown
    const userInfo = userDropdown.locator('text=/@|admin|user|account/i').first();
    await expect(userInfo).toBeVisible({ timeout: 5000 });

    // Close the dropdown
    await page.keyboard.press("Escape");
  });
});
