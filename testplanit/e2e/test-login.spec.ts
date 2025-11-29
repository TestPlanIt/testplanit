import { test, expect } from "@playwright/test";

test.describe("Test Login", () => {
  // Clear authentication state for these tests
  test.use({ storageState: { cookies: [], origins: [] } });

  test("can login as group-only user", async ({ page }) => {
    // Navigate to signin page
    await page.goto("/en-US/signin");

    // Fill in credentials
    await page.getByTestId("email-input").fill("ac_group_only@test.com");
    await page.getByTestId("password-input").fill("Test123!");

    // Click sign in
    await page.getByTestId("signin-button").click({ force: true });

    // Wait for navigation
    await page.waitForLoadState("networkidle");

    // Check we're on projects page or redirected appropriately
    const url = page.url();
    console.log("After login URL:", url);

    // Should either be on projects page or have been redirected
    expect(url).toMatch(/\/(projects|en-US)/);

    // Try to navigate to projects page explicitly
    await page.goto("/en-US/projects");
    await page.waitForLoadState("networkidle");

    // Check if we can see any projects
    const projectsVisible = await page
      .locator("text=AC_NoAccess_Default")
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    console.log("Can see AC_NoAccess_Default:", projectsVisible);

    expect(projectsVisible).toBe(true);
  });
});
