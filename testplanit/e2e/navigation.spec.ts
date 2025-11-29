import { test, expect } from "@playwright/test";
import { SignInPage } from "./pages/SignInPage";
import { users } from "./fixtures/users";
import { loginAsAdmin } from "./helpers/auth";

// Base URL for admin section
const ADMIN_BASE_URL = "/en-US/admin";

// Group for tests that require authentication
test.describe("Navigation Tests (Authenticated - Admin) @navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("should navigate to the users page", async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/users`);
    await expect(page.locator("table")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("users-page-title")).toBeVisible({
      timeout: 10000,
    });
  });

  test("should navigate to the tags page", async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/tags`);
    await expect(page.locator("table")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("tags-page-title")).toBeVisible({
      timeout: 10000,
    });
  });

  test("should navigate to the admin page and show admin navigation", async ({
    page,
  }) => {
    await page.goto(`${ADMIN_BASE_URL}`);
    
    // Wait for a specific element that indicates the admin page has loaded
    await expect(page.getByTestId("admin-page-title")).toBeVisible({ timeout: 10000 });
    
    // Verify the admin navigation links are visible
    await expect(page.locator('#admin-menu').getByRole("link", { name: "Projects" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#admin-menu').getByRole("link", { name: "Users" })).toBeVisible({ timeout: 10000 });
  });

  test("should navigate to the milestones page", async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/milestones`);
    await expect(page.locator("table")).toBeVisible();
    await expect(page.getByTestId("milestones-page-title")).toBeVisible();
  });

  test("should navigate to the reports page", async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/reports`);
    
    // Wait for the page title instead of networkidle
    await expect(page.getByTestId("adminreports-page-title")).toBeVisible({ timeout: 30000 });
    
    // Verify report-related elements
    await expect(
      page.locator('label:has-text("Dimensions")')
    ).toBeVisible({ timeout: 30000 });
    
    await expect(
      page.locator('label:has-text("Metrics")')
    ).toBeVisible({ timeout: 30000 });
  });

  test("should navigate to the integrations page", async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/integrations`);
    // Wait for the page to load and check for integrations-specific content
    await expect(page.getByTestId("admin-page-title")).toBeVisible({
      timeout: 15000,
    });
  });
});

// Optional: Add a group for tests requiring a different user role
/*
test.describe("Navigation Tests (Authenticated - Regular User)", () => {
  test.beforeEach(async ({ page }) => {
    const signInPage = new SignInPage(page);
    const regularUser = users.regular; // Get regular user
    await signInPage.goto();
    await signInPage.login(regularUser.email, regularUser.password);
    await page.waitForLoadState('networkidle');
  });

  // Add tests specific to the regular user role here
  // For example, ensuring they *cannot* access the admin page
  test("should not be able to access the admin page", async ({ page }) => {
    const adminPage = new AdminPage(page);
    await adminPage.goto(); // Attempt to navigate
    // Expect a redirect to dashboard or a specific "access denied" message/element
    await expect(page.getByText('Your Dashboard')).toBeVisible(); // Assuming redirect to dashboard
    // Or: await expect(page.getByText('Access Denied')).toBeVisible();
  });
});
*/

// Group for tests that do not require authentication
test.describe("Navigation Tests (Unauthenticated) @navigation", () => {
  // Use a clean storage state for this group of tests
  test.use({ storageState: { cookies: [], origins: [] } });

  test("should navigate to the sign-in page and check the Sign In button", async ({
    page,
  }) => {
    const signInPage = new SignInPage(page);
    await signInPage.goto();
    await signInPage.expectSignInButtonToBeVisible();
  });

  test("should navigate to the sign-up page", async ({
    page,
  }) => {
    const response = await page.goto("/en-US/signup");
    
    // Check that the page loaded successfully
    expect(response?.status()).toBeLessThan(400);
    
    // Wait for content to load
    await page.waitForLoadState("domcontentloaded");
    
    // Simply verify we're on a signup or signin page (depending on SSO configuration)
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/(signup|signin)/);
  });

  test("should navigate to the verify-email page", async ({ page }) => {
    await page.goto(
      `/en-US/verify-email?email=${"verify@test.com"}&token=${"123456789"}`
    );
    // The verify-email page might redirect or show an error
    // Wait for either signin page or an error message
    await Promise.race([
      page.waitForURL("**/signin", { timeout: 10000 }),
      page.waitForSelector('[role="alert"]', { timeout: 10000 }),
      page.waitForSelector('text=/invalid|expired|error/i', { timeout: 10000 })
    ]);
    
    // If we're on signin page, verify it loaded
    if (page.url().includes('/signin')) {
      const signInPage = new SignInPage(page);
      await signInPage.expectSignInButtonToBeVisible();
    }
  });
});
